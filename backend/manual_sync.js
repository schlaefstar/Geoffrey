const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { PGlite } = require('@electric-sql/pglite');
const path = require('path');
const readline = require('readline');

// Database setup
const db = new PGlite('./pgdata');

// Helper to extract metadata
function extractMetadataFromFilename(filename) {
    const segments = filename.split('_');
    let eventId = filename;
    let userId = segments.length > 0 ? segments[0] : 'Unknown';
    let deviceId = segments.length > 1 ? segments[1] : 'Unknown';
    let cameraModel = 'Unknown';
    let timestamp = new Date(0);

    if (segments.length >= 3) {
        const segment2 = segments[2];
        const numericMatch = segment2.match(/^(\d+)/);
        if (numericMatch) {
            eventId = numericMatch[1];
            if (segments.length >= 5) {
                cameraModel = segments[3];
                const timestampStr = segments[4].split('.')[0];
                const tsParts = timestampStr.split('-');
                if (tsParts.length >= 6) {
                    timestamp = new Date(
                        parseInt(tsParts[0]),
                        parseInt(tsParts[1]) - 1,
                        parseInt(tsParts[2]),
                        parseInt(tsParts[3]),
                        parseInt(tsParts[4]),
                        parseInt(tsParts[5])
                    );
                }
            }
        } else {
            // Combined format logic (simplified for this script)
            const parts = segment2.split('-');
            if (parts.length >= 2) {
                eventId = parts[0];
                if (segments.length >= 4) {
                    const timestampStr = segments[3].split('.')[0];
                    const tsParts = timestampStr.split('-');
                    if (tsParts.length >= 6) {
                        timestamp = new Date(
                            parseInt(tsParts[0]),
                            parseInt(tsParts[1]) - 1,
                            parseInt(tsParts[2]),
                            parseInt(tsParts[3]),
                            parseInt(tsParts[4]),
                            parseInt(tsParts[5])
                        );
                    }
                }
            }
        }
    }
    return { eventId, userId, deviceId, cameraModel, timestamp };
}

async function runSync(credentials) {
    const s3Client = new S3Client({
        region: 'us-east-1',
        credentials
    });

    const BUCKET_NAME = 'ml-training-data-vision';
    const prefix = 'us-prod/submitted/video/2025/11/';

    console.log(`\nStarting sync for ${prefix}...`);

    let continuationToken = undefined;
    let allFiles = [];

    try {
        do {
            const command = new ListObjectsV2Command({
                Bucket: BUCKET_NAME,
                Prefix: prefix,
                ContinuationToken: continuationToken
            });
            const response = await s3Client.send(command);
            if (response.Contents) {
                allFiles = allFiles.concat(response.Contents);
                process.stdout.write(`\rFetched ${allFiles.length} files so far...`);
            }
            continuationToken = response.NextContinuationToken;
        } while (continuationToken);

        console.log(`\n\nProcessing ${allFiles.length} files into database...`);

        for (const file of allFiles) {
            const filename = path.basename(file.Key);
            const metadata = extractMetadataFromFilename(filename);

            // Upsert Event
            await db.query(`
                INSERT INTO events (event_id, user_id, device_id, camera_model, timestamp, s3_prefix, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (event_id) DO UPDATE SET
                    status = EXCLUDED.status;
            `, [metadata.eventId, metadata.userId, metadata.deviceId, metadata.cameraModel, metadata.timestamp, prefix, 'available']);

            // Upsert File
            const ext = path.extname(filename).toLowerCase();
            let type = 'other';
            if (ext === '.mp4') type = 'video';
            else if (ext === '.json') type = 'json';
            else if (ext === '.jpg') type = 'jpg';
            else if (filename.endsWith('.json.gz')) type = 'json.gz';

            await db.query(`
                INSERT INTO files (key, event_id, file_type, size, s3_last_modified, local_path)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (key) DO UPDATE SET
                    size = EXCLUDED.size,
                    s3_last_modified = EXCLUDED.s3_last_modified;
            `, [file.Key, metadata.eventId, type, file.Size, file.LastModified, null]);
        }

        // Update sync status
        await db.query(`
            INSERT INTO sync_status (year_month, status, last_synced_at)
            VALUES ($1, $2, $3)
            ON CONFLICT (year_month) DO UPDATE SET
                status = EXCLUDED.status,
                last_synced_at = EXCLUDED.last_synced_at;
        `, ['2025-11', 'idle', new Date()]);

        console.log('\n✅ Sync completed successfully!');
        console.log(`Total files processed: ${allFiles.length}`);

    } catch (error) {
        console.error('\n❌ Sync failed:', error.message);
    } finally {
        await db.close();
    }
}

// Check for env vars first
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    console.log('Found credentials in environment variables.');
    runSync({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN
    });
} else {
    // Interactive prompt
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log('Please paste your AWS credentials (one line per variable):');
    console.log('Example:');
    console.log('export AWS_ACCESS_KEY_ID="..."');
    console.log('export AWS_SECRET_ACCESS_KEY="..."');
    console.log('export AWS_SESSION_TOKEN="..."');
    console.log('\nPaste now (press Enter twice to finish):');

    let lines = [];
    rl.on('line', (line) => {
        if (line.trim() === '') {
            if (lines.length > 0) {
                rl.close();
            }
        } else {
            lines.push(line);
        }
    });

    rl.on('close', () => {
        const creds = {};
        lines.forEach(line => {
            const match = line.match(/export\s+AWS_(\w+)="([^"]+)"/);
            if (match) {
                const [, key, value] = match;
                if (key === 'ACCESS_KEY_ID') creds.accessKeyId = value;
                else if (key === 'SECRET_ACCESS_KEY') creds.secretAccessKey = value;
                else if (key === 'SESSION_TOKEN') creds.sessionToken = value;
            }
        });

        if (creds.accessKeyId && creds.secretAccessKey) {
            runSync(creds);
        } else {
            console.error('❌ Could not parse credentials. Please try again.');
        }
    });
}
