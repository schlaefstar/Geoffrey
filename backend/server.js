const express = require('express');
const cors = require('cors');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs-extra');
const path = require('path');
const { pipeline } = require('stream/promises');
const zlib = require('zlib');
const dotenv = require('dotenv');

// Load env with debug
const result = dotenv.config();
if (result.error) {
    console.error('Error loading .env:', result.error);
} else {
    console.log('Dotenv loaded:', result.parsed ? Object.keys(result.parsed) : 'null');
}

// Global error handlers
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION:', reason);
});

const {
    initDB,
    upsertEvent,
    upsertFile,
    getEvents,
    getEventFiles,
    setFileDownloaded,
    markEventDownloaded,
    getSyncStatus,
    updateSyncStatus
} = require('./db');

const app = express();
const PORT = 3001;

// Enable CORS for frontend
app.use(cors({
    origin: 'http://localhost:5173'
}));

app.use(express.json());

const BUCKET_NAME = 'ml-training-data-vision';
const BASE_PREFIX = 'us-prod/submitted/video/';
const REGION = 'us-east-1';

// Create S3 client with environment credentials
const getS3Client = () => {
    return new S3Client({
        region: REGION,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
        },
    });
};

// Initialize DB
initDB().catch(console.error);

// Helper to extract metadata from filename (Ported from Frontend)
function extractMetadataFromFilename(filename) {
    const segments = filename.split('_');
    let eventId = filename;
    let userId = segments.length > 0 ? segments[0] : 'Unknown';
    let deviceId = segments.length > 1 ? segments[1] : 'Unknown';
    let cameraModel = 'Unknown';
    let timestamp = new Date(0);

    if (segments.length >= 3) {
        // Check if segment 2 is purely numeric (Standard Format) or alphanumeric (Combined Format)
        const segment2 = segments[2];
        const numericMatch = segment2.match(/^(\d+)/);
        if (numericMatch) {
            eventId = numericMatch[1];
        }

        const isStandardFormat = /^\d+$/.test(segment2);
        if (isStandardFormat) {
            // Format A: userId_deviceId_eventId_cameraModel_timestamp_...
            if (segments.length >= 4) cameraModel = segments[3];
            if (segments.length >= 5) {
                const timestampStr = segments[4];
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
            // Format B: userId_deviceId_eventIdCameraModel_timestamp.ext
            cameraModel = segment2.replace(/^\d+/, '');
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
    return { eventId, userId, deviceId, cameraModel, timestamp };
}





// Sync Endpoint (Automated Logic)
app.post('/api/sync', async (req, res) => {
    const { year, month, force } = req.body;
    if (!year || !month) return res.status(400).json({ error: 'Year and month required' });

    try {
        // Check last sync time
        const syncStatus = await getSyncStatus(year, month);
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

        // If synced recently and not forced, return early
        if (!force && syncStatus.last_synced_at && new Date(syncStatus.last_synced_at) > oneHourAgo) {
            return res.json({
                success: true,
                message: 'Synced recently',
                lastSyncedAt: syncStatus.last_synced_at,
                skipped: true
            });
        }

        // Update status to syncing
        await updateSyncStatus(year, month, 'syncing');

        const prefix = `${BASE_PREFIX}${year}/${month}/`;
        let continuationToken = undefined;
        let allFiles = [];

        // Fetch all files from S3 (pagination)
        do {
            const command = new ListObjectsV2Command({
                Bucket: BUCKET_NAME,
                Prefix: prefix,
                ContinuationToken: continuationToken
            });
            const response = await getS3Client().send(command);
            if (response.Contents) {
                allFiles = allFiles.concat(response.Contents);
            }
            continuationToken = response.NextContinuationToken;
        } while (continuationToken);

        // Process files and update DB
        console.log(`Processing ${allFiles.length} files...`);
        for (const file of allFiles) {
            const filename = path.basename(file.Key);
            const metadata = extractMetadataFromFilename(filename);

            console.log(`File: ${filename}, EventID: ${metadata.eventId}`);

            // Upsert Event
            await upsertEvent({
                eventId: metadata.eventId,
                userId: metadata.userId,
                deviceId: metadata.deviceId,
                cameraModel: metadata.cameraModel,
                timestamp: metadata.timestamp,
                s3Prefix: prefix,
                status: 'available'
            });

            // Upsert File
            const ext = path.extname(filename).toLowerCase();
            let type = 'other';
            if (ext === '.mp4') type = 'video';
            else if (ext === '.json') type = 'json';
            else if (ext === '.jpg') type = 'jpg';
            else if (filename.endsWith('.json.gz')) type = 'json.gz';

            await upsertFile({
                key: file.Key,
                eventId: metadata.eventId,
                type: type,
                size: file.Size,
                lastModified: file.LastModified,
                localPath: null // Will be updated on download
            });
        }

        console.log(`Sync complete. Processed ${allFiles.length} files.`);

        // Update status to idle and set last synced time
        await updateSyncStatus(year, month, 'idle', new Date());

        res.json({ success: true, count: allFiles.length, lastSyncedAt: new Date() });
    } catch (error) {
        console.error('Sync failed:', error);
        await updateSyncStatus(year, month, 'error');
        res.status(500).json({ error: error.message });
    }
});

// Get Sync Status Endpoint
app.get('/api/sync/status', async (req, res) => {
    const { year, month } = req.query;
    if (!year || !month) return res.status(400).json({ error: 'Year and month required' });

    try {
        const status = await getSyncStatus(year, month);
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// List years
app.get('/api/years', async (req, res) => {
    console.log('📥 /api/years request received');
    try {
        console.log('Creating S3 command...');
        const command = new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: BASE_PREFIX,
            Delimiter: '/',
        });

        console.log('Sending S3 request...');
        const response = await getS3Client().send(command);
        console.log('S3 response received');

        if (!response.CommonPrefixes) {
            console.log('No common prefixes found');
            return res.json([]);
        }

        const years = response.CommonPrefixes
            .map(prefix => prefix.Prefix?.replace(BASE_PREFIX, '').replace('/', '') || '')
            .filter(Boolean)
            .sort((a, b) => parseInt(b) - parseInt(a));

        console.log('✅ Returning years:', years);
        res.json(years);
    } catch (error) {
        console.error('❌ Error listing years:', error);
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        res.status(500).json({ error: error.message });
    }
});

// List months for a year
app.get('/api/years/:year/months', async (req, res) => {
    try {
        const { year } = req.params;
        const command = new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: `${BASE_PREFIX}${year}/`,
            Delimiter: '/',
        });

        const response = await getS3Client().send(command);

        if (!response.CommonPrefixes) {
            return res.json([]);
        }

        const months = response.CommonPrefixes
            .map(prefix => prefix.Prefix?.replace(`${BASE_PREFIX}${year}/`, '').replace('/', '') || '')
            .filter(Boolean)
            .sort((a, b) => parseInt(b) - parseInt(a));

        res.json(months);
    } catch (error) {
        console.error('Error listing months:', error);
        res.status(500).json({ error: error.message });
    }
});

// List files for a year/month with pagination
app.get('/api/years/:year/months/:month/files', async (req, res) => {
    try {
        const { year, month } = req.params;
        const { continuationToken, maxKeys = '100' } = req.query;
        const prefix = `${BASE_PREFIX}${year}/${month}/`;

        const command = new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: prefix,
            MaxKeys: parseInt(maxKeys),
            ...(continuationToken && { ContinuationToken: continuationToken }),
        });

        const response = await getS3Client().send(command);

        if (!response.Contents) {
            return res.json({ files: [], nextContinuationToken: null });
        }

        const files = response.Contents.map(item => {
            const key = item.Key || '';
            let type = 'other';

            if (key.endsWith('.mp4')) type = 'video';
            else if (key.endsWith('.json.gz')) type = 'json.gz';
            else if (key.endsWith('.json')) type = 'json';
            else if (key.endsWith('.jpg')) type = 'jpg';

            return {
                key,
                size: item.Size || 0,
                lastModified: item.LastModified,
                type,
            };
        });

        res.json({
            files,
            nextContinuationToken: response.NextContinuationToken || null,
            isTruncated: response.IsTruncated || false,
        });
    } catch (error) {
        console.error('Error listing files:', error);
        res.status(500).json({ error: error.message });
    }
});

const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

// Ensure downloads directory exists
fs.ensureDirSync(DOWNLOADS_DIR);

// Get Events from DB
app.get('/api/events', async (req, res) => {
    try {
        const { year, month, sort, dir } = req.query;
        if (!year || !month) {
            return res.status(400).json({ error: 'Year and month required' });
        }

        const events = await getEvents(year, month, sort, dir);

        // Populate files for each event
        for (const event of events) {
            event.files = await getEventFiles(event.eventId);
        }

        res.json(events);
    } catch (error) {
        console.error('Get events failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// Download file endpoint
app.post('/api/download', async (req, res) => {
    const { year, month, eventId } = req.body;
    if (!year || !month || !eventId) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    const eventDir = path.join(DOWNLOADS_DIR, year, month, eventId);
    await fs.ensureDir(eventDir);

    try {
        // List files for the event
        const prefix = `${BASE_PREFIX}/${year}/${month}/`;
        const command = new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: prefix
        });
        const response = await getS3Client().send(command);

        // Filter files for this specific event ID
        const eventFiles = (response.Contents || []).filter(file => {
            const filename = path.basename(file.Key);
            // Check if filename contains the event ID (either as segment or part of combined string)
            return filename.includes(eventId);
        });

        if (eventFiles.length === 0) {
            return res.status(404).json({ error: 'Event not found' });
        }

        // Download each file
        for (const file of eventFiles) {
            const filename = path.basename(file.Key);
            let localFilename = filename;

            // Handle .json.gz files - decompress and save as .json
            if (filename.endsWith('.json.gz')) {
                localFilename = filename.replace('.json.gz', '.json');
            }

            const localFilePath = path.join(eventDir, localFilename);

            // Get file stream from S3
            const getCommand = new GetObjectCommand({
                Bucket: BUCKET_NAME,
                Key: file.Key
            });
            const { Body } = await getS3Client().send(getCommand);

            // Save file (decompress if needed)
            if (filename.endsWith('.json.gz')) {
                await pipeline(
                    Body,
                    zlib.createGunzip(),
                    fs.createWriteStream(localFilePath)
                );
            } else {
                await pipeline(Body, fs.createWriteStream(localFilePath));
            }

            // Update DB status
            await setFileDownloaded(file.Key, localFilePath);
        }

        // Mark event as downloaded
        await markEventDownloaded(eventId);

        res.json({ success: true, path: eventDir });
    } catch (error) {
        console.error('Download failed:', error);
        res.status(500).json({ error: 'Download failed: ' + error.message });
    }
});

// Check download status
app.get('/api/downloads/:year/:month/:eventId', async (req, res) => {
    try {
        const { year, month, eventId } = req.params;
        const eventDir = path.join(DOWNLOADS_DIR, year, month, eventId);

        const exists = await fs.pathExists(eventDir);

        if (!exists) {
            return res.json({ downloaded: false, files: [] });
        }

        const files = await fs.readdir(eventDir);
        const fileDetails = await Promise.all(
            files.map(async (filename) => {
                const filePath = path.join(eventDir, filename);
                const stats = await fs.stat(filePath);
                let type = 'other';

                if (filename.endsWith('.mp4')) type = 'video';
                else if (filename.endsWith('.json.gz')) type = 'json.gz';
                else if (filename.endsWith('.json')) type = 'json';
                else if (filename.endsWith('.jpg')) type = 'jpg';

                return {
                    filename,
                    size: stats.size,
                    type,
                };
            })
        );

        res.json({
            downloaded: true,
            files: fileDetails,
            localPath: eventDir,
        });
    } catch (error) {
        console.error('Error checking download status:', error);
        res.status(500).json({ error: error.message });
    }
});

// Serve downloaded files
app.get('/api/files/:year/:month/:eventId/:filename', async (req, res) => {
    try {
        const { year, month, eventId, filename } = req.params;
        const filePath = path.join(DOWNLOADS_DIR, year, month, eventId, filename);

        const exists = await fs.pathExists(filePath);

        if (!exists) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Set appropriate content type
        if (filename.endsWith('.mp4')) {
            res.contentType('video/mp4');
        } else if (filename.endsWith('.jpg')) {
            res.contentType('image/jpeg');
        } else if (filename.endsWith('.json')) {
            res.contentType('application/json');
        }

        // Stream the file
        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
    } catch (error) {
        console.error('Error serving file:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete downloaded event
app.delete('/api/downloads/:year/:month/:eventId', async (req, res) => {
    try {
        const { year, month, eventId } = req.params;
        const eventDir = path.join(DOWNLOADS_DIR, year, month, eventId);

        const exists = await fs.pathExists(eventDir);

        if (!exists) {
            return res.json({ success: true, message: 'Already deleted' });
        }

        await fs.remove(eventDir);

        res.json({ success: true, message: 'Event deleted' });
    } catch (error) {
        console.error('Error deleting files:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚪 Geoffrey backend running on http://localhost:${PORT}`);
});
