require('dotenv').config();
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const db = require('./db');
const path = require('path');

const BUCKET_NAME = 'ml-training-data-vision';
const BASE_PREFIX = 'us-prod/submitted/video/';
const SYNC_THRESHOLD_HOURS = 24; // Re-sync if older than 24 hours

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
  },
});

// Extract metadata from S3 filename
function parseFilename(filename) {
  const segments = filename.split('_');
  if (segments.length < 3) return null;

  const userId = segments[0];
  const deviceId = segments[1];
  const segment2 = segments[2];

  // Extract event ID (numeric part at start of segment 2)
  const eventIdMatch = segment2.match(/^(\d+)/);
  if (!eventIdMatch) return null;

  const eventId = eventIdMatch[1];
  const cameraModel = segment2.replace(/^\d+/, '') || 'Unknown';

  // Parse timestamp if available
  let timestamp = 0;
  if (segments.length >= 5) {
    const timestampStr = segments[4].split('.')[0];
    const parts = timestampStr.split('-');
    if (parts.length === 6) {
      const date = new Date(
        parseInt(parts[0]), // year
        parseInt(parts[1]) - 1, // month (0-indexed)
        parseInt(parts[2]), // day
        parseInt(parts[3]), // hour
        parseInt(parts[4]), // minute
        parseInt(parts[5])  // second
      );
      timestamp = Math.floor(date.getTime() / 1000);
    }
  }

  return { eventId, userId, deviceId, cameraModel, timestamp };
}

// Discover all year/month combinations in S3
async function discoverYearMonths() {
  console.log('🔍 Discovering available data in S3...');

  const yearMonths = [];

  // List years
  const yearsResponse = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET_NAME,
    Prefix: BASE_PREFIX,
    Delimiter: '/'
  }));

  if (!yearsResponse.CommonPrefixes) {
    console.log('❌ No data found in S3');
    return [];
  }

  const years = yearsResponse.CommonPrefixes
    .map(p => p.Prefix.replace(BASE_PREFIX, '').replace('/', ''))
    .filter(Boolean);

  // List months for each year
  for (const year of years) {
    const monthsResponse = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: `${BASE_PREFIX}${year}/`,
      Delimiter: '/'
    }));

    if (monthsResponse.CommonPrefixes) {
      const months = monthsResponse.CommonPrefixes
        .map(p => p.Prefix.replace(`${BASE_PREFIX}${year}/`, '').replace('/', ''))
        .filter(Boolean);

      for (const month of months) {
        yearMonths.push({ year, month });
      }
    }
  }

  console.log(`✅ Found ${yearMonths.length} year/month combinations`);
  return yearMonths;
}

// Check if a year/month needs syncing
function needsSync(year, month) {
  const lastSync = db.prepare(`
    SELECT completed_at
    FROM sync_log
    WHERE year = ? AND month = ? AND status = 'completed'
    ORDER BY completed_at DESC
    LIMIT 1
  `).get(year, month);

  if (!lastSync) {
    return { needed: true, reason: 'never synced' };
  }

  const hoursSinceSync = (Date.now() / 1000 - lastSync.completed_at) / 3600;

  if (hoursSinceSync > SYNC_THRESHOLD_HOURS) {
    return { needed: true, reason: `${Math.floor(hoursSinceSync)}h since last sync` };
  }

  return { needed: false, reason: `synced ${Math.floor(hoursSinceSync)}h ago` };
}

// Sync a specific year/month
async function syncYearMonth(year, month) {
  console.log(`\n🔄 Syncing ${year}/${month}...`);

  const startTime = Math.floor(Date.now() / 1000);
  const prefix = `${BASE_PREFIX}${year}/${month}/`;

  let continuationToken;
  let totalFiles = 0;
  const events = new Map();

  // Fetch all files from S3
  do {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
      ContinuationToken: continuationToken
    });

    const response = await s3.send(command);

    if (response.Contents) {
      for (const file of response.Contents) {
        totalFiles++;
        const filename = path.basename(file.Key);
        const metadata = parseFilename(filename);

        if (!metadata) continue;

        if (!events.has(metadata.eventId)) {
          events.set(metadata.eventId, {
            eventId: metadata.eventId,
            userId: metadata.userId,
            deviceId: metadata.deviceId,
            cameraModel: metadata.cameraModel,
            timestamp: metadata.timestamp,
            fileCount: 0,
            hasVideo: 0,
            hasJson: 0
          });
        }

        const event = events.get(metadata.eventId);
        event.fileCount++;

        if (filename.endsWith('.mp4')) event.hasVideo = 1;
        if (filename.endsWith('.json') || filename.endsWith('.json.gz')) event.hasJson = 1;
      }
    }

    continuationToken = response.NextContinuationToken;

    // Show progress
    if (totalFiles % 1000 === 0) {
      process.stdout.write(`\r   📥 Processed ${totalFiles} files...`);
    }
  } while (continuationToken);

  if (totalFiles % 1000 !== 0) {
    process.stdout.write(`\r   📥 Processed ${totalFiles} files...`);
  }
  console.log('');

  // Insert events into database
  const insert = db.prepare(`
    INSERT OR REPLACE INTO events
    (event_id, user_id, device_id, camera_model, timestamp, year, month, file_count, has_video, has_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((events) => {
    for (const event of events) {
      insert.run(
        event.eventId,
        event.userId,
        event.deviceId,
        event.cameraModel,
        event.timestamp,
        year,
        month,
        event.fileCount,
        event.hasVideo,
        event.hasJson
      );
    }
  });

  insertMany(Array.from(events.values()));

  // Log sync
  const completedAt = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO sync_log (year, month, files_synced, events_synced, started_at, completed_at, status)
    VALUES (?, ?, ?, ?, ?, ?, 'completed')
  `).run(year, month, totalFiles, events.size, startTime, completedAt);

  console.log(`   ✅ Synced ${events.size} events (${totalFiles} files) in ${completedAt - startTime}s`);

  return { events: events.size, files: totalFiles };
}

// Main intelligent sync
async function intelligentSync() {
  console.log('🚪 Geoffrey Intelligent Sync\n');

  try {
    // Discover what's available in S3
    const availableData = await discoverYearMonths();

    if (availableData.length === 0) {
      console.log('\n❌ No data found in S3');
      return;
    }

    // Check what needs syncing
    const toSync = [];
    const skipped = [];

    console.log('\n📋 Checking sync status...');
    for (const { year, month } of availableData) {
      const check = needsSync(year, month);
      if (check.needed) {
        toSync.push({ year, month, reason: check.reason });
        console.log(`   ⏳ ${year}/${month.padStart(2, '0')} - ${check.reason}`);
      } else {
        skipped.push({ year, month });
        console.log(`   ✓  ${year}/${month.padStart(2, '0')} - ${check.reason}`);
      }
    }

    if (toSync.length === 0) {
      console.log('\n✨ Everything is up to date!');
      return;
    }

    console.log(`\n📦 Syncing ${toSync.length} year/month(s), skipping ${skipped.length}...`);

    let totalEvents = 0;
    let totalFiles = 0;

    for (const { year, month } of toSync) {
      const result = await syncYearMonth(year, month);
      totalEvents += result.events;
      totalFiles += result.files;
    }

    console.log(`\n✨ Sync complete!`);
    console.log(`   📊 Total: ${totalEvents.toLocaleString()} events, ${totalFiles.toLocaleString()} files`);
    console.log(`   ⏭️  Skipped: ${skipped.length} already up-to-date`);

  } catch (error) {
    console.error('\n❌ Sync failed:', error.message);
    process.exit(1);
  }
}

// Allow manual year/month sync too
async function manualSync(year, month) {
  console.log('🚪 Geoffrey Manual Sync\n');
  try {
    await syncYearMonth(year, month);
    console.log('\n✨ Sync complete!');
  } catch (error) {
    console.error('\n❌ Sync failed:', error.message);
    process.exit(1);
  }
}

// Main
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // Intelligent auto-sync
    await intelligentSync();
  } else if (args.length === 2) {
    // Manual year/month sync
    await manualSync(args[0], args[1]);
  } else {
    console.log('Usage:');
    console.log('  node sync.js              # Intelligent auto-sync');
    console.log('  node sync.js <year> <month>  # Manual sync specific month');
    console.log('\nExample:');
    console.log('  node sync.js 2024 12');
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { syncYearMonth, intelligentSync };
