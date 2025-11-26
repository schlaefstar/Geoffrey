const { PGlite } = require('@electric-sql/pglite');
const path = require('path');
const fs = require('fs-extra');

const DB_PATH = path.join(__dirname, 'pgdata');

// Ensure data directory exists
fs.ensureDirSync(DB_PATH);

const db = new PGlite(DB_PATH);

async function initDB() {
    console.log('Initializing database...');

    // Create Events table
    await db.exec(`
        CREATE TABLE IF NOT EXISTS events (
            event_id TEXT PRIMARY KEY,
            user_id TEXT,
            device_id TEXT,
            camera_model TEXT,
            timestamp TIMESTAMP,
            s3_prefix TEXT,
            status TEXT DEFAULT 'available',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Create Files table
    await db.exec(`
        CREATE TABLE IF NOT EXISTS files (
            key TEXT PRIMARY KEY,
            event_id TEXT REFERENCES events(event_id),
            file_type TEXT,
            size INTEGER,
            s3_last_modified TIMESTAMP,
            is_downloaded BOOLEAN DEFAULT FALSE,
            local_path TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Create Sync Status table
    await db.exec(`
        CREATE TABLE IF NOT EXISTS sync_status (
            year_month TEXT PRIMARY KEY, -- Format: 'YYYY-MM'
            last_synced_at TIMESTAMP,
            status TEXT DEFAULT 'idle' -- 'idle', 'syncing', 'error'
        );
    `);

    // Create indexes for performance
    console.log('Creating indexes...');
    await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_files_event_id ON files(event_id);
        CREATE INDEX IF NOT EXISTS idx_files_file_type ON files(file_type);
        CREATE INDEX IF NOT EXISTS idx_events_s3_prefix ON events(s3_prefix);
        CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);
    `);

    console.log('Database initialized.');
}

async function upsertEvent(event) {
    await db.query(`
        INSERT INTO events (event_id, user_id, device_id, camera_model, timestamp, s3_prefix, status, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
        ON CONFLICT (event_id) DO UPDATE SET
            status = EXCLUDED.status,
            updated_at = CURRENT_TIMESTAMP;
    `, [event.eventId, event.userId, event.deviceId, event.cameraModel, event.timestamp, event.s3Prefix, event.status || 'available']);
}

async function upsertFile(file) {
    await db.query(`
        INSERT INTO files (key, event_id, file_type, size, s3_last_modified, is_downloaded, local_path)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (key) DO UPDATE SET
            size = EXCLUDED.size,
            s3_last_modified = EXCLUDED.s3_last_modified,
            is_downloaded = COALESCE(files.is_downloaded, EXCLUDED.is_downloaded),
            local_path = COALESCE(files.local_path, EXCLUDED.local_path);
    `, [file.key, file.eventId, file.type, file.size, file.lastModified, file.isDownloaded || false, file.localPath]);
}

async function getEvents(year, month, sortColumn = 'timestamp', sortDirection = 'desc') {
    // Map frontend sort columns to DB columns
    const colMap = {
        'eventId': 'event_id',
        'userId': 'user_id',
        'deviceId': 'device_id',
        'timestamp': 'timestamp',
        'fileCount': 'file_count' // handled in subquery/aggregation
    };

    const dbCol = colMap[sortColumn] || 'timestamp';
    const dir = sortDirection === 'asc' ? 'ASC' : 'DESC';

    // Construct S3 prefix to filter by
    // Note: This assumes s3_prefix is stored as '.../year/month/'
    // We'll use a LIKE query to match the prefix
    const prefixFilter = `%/${year}/${month}/`;

    // Fetch events with file counts and types
    const result = await db.query(`
        SELECT 
            e.*,
            COUNT(f.key) as file_count,
            COUNT(CASE WHEN f.file_type = 'video' THEN 1 END) as video_count,
            COUNT(CASE WHEN f.file_type = 'json' THEN 1 END) as json_count,
            COUNT(CASE WHEN f.file_type = 'jpg' THEN 1 END) as jpg_count,
            COUNT(CASE WHEN f.file_type = 'json.gz' THEN 1 END) as json_gz_count
        FROM events e
        LEFT JOIN files f ON e.event_id = f.event_id
        WHERE e.s3_prefix LIKE $1
        GROUP BY e.event_id
        ORDER BY ${dbCol} ${dir}
    `, [prefixFilter]);

    return result.rows.map(row => ({
        eventId: row.event_id,
        userId: row.user_id,
        deviceId: row.device_id,
        cameraModel: row.camera_model,
        timestamp: row.timestamp,
        fileCount: parseInt(row.file_count),
        fileTypes: {
            video: parseInt(row.video_count),
            json: parseInt(row.json_count),
            jpg: parseInt(row.jpg_count),
            jsonGz: parseInt(row.json_gz_count)
        },
        status: row.status
    }));
}

async function getEventFiles(eventId) {
    const result = await db.query(`
        SELECT * FROM files WHERE event_id = $1 ORDER BY key
    `, [eventId]);

    return result.rows.map(row => ({
        key: row.key,
        type: row.file_type,
        size: row.size,
        lastModified: row.s3_last_modified,
        isDownloaded: row.is_downloaded,
        localPath: row.local_path
    }));
}

async function setFileDownloaded(key, localPath) {
    await db.query(`
        UPDATE files 
        SET is_downloaded = TRUE, local_path = $2 
        WHERE key = $1
    `, [key, localPath]);
}

async function markEventDownloaded(eventId) {
    await db.query(`
        UPDATE events SET status = 'downloaded' WHERE event_id = $1
    `, [eventId]);
}

async function getSyncStatus(year, month) {
    const yearMonth = `${year}-${month}`;
    const result = await db.query(`
        SELECT * FROM sync_status WHERE year_month = $1
    `, [yearMonth]);
    return result.rows[0] || { year_month: yearMonth, last_synced_at: null, status: 'idle' };
}

async function updateSyncStatus(year, month, status, lastSyncedAt = null) {
    const yearMonth = `${year}-${month}`;
    if (lastSyncedAt) {
        await db.query(`
            INSERT INTO sync_status (year_month, status, last_synced_at)
            VALUES ($1, $2, $3)
            ON CONFLICT (year_month) DO UPDATE SET
                status = EXCLUDED.status,
                last_synced_at = EXCLUDED.last_synced_at;
        `, [yearMonth, status, lastSyncedAt]);
    } else {
        await db.query(`
            INSERT INTO sync_status (year_month, status)
            VALUES ($1, $2)
            ON CONFLICT (year_month) DO UPDATE SET
                status = EXCLUDED.status;
        `, [yearMonth, status]);
    }
}

module.exports = {
    initDB,
    upsertEvent,
    upsertFile,
    getEvents,
    getEventFiles,
    setFileDownloaded,
    markEventDownloaded,
    getSyncStatus,
    updateSyncStatus
};
