const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Database will persist in the data directory
const DB_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const DB_PATH = path.join(DB_DIR, 'geoffrey.db');
console.log('📁 Database:', DB_PATH);

const db = new Database(DB_PATH);

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    event_id TEXT PRIMARY KEY,
    user_id TEXT,
    device_id TEXT,
    camera_model TEXT,
    timestamp INTEGER,
    year TEXT,
    month TEXT,
    file_count INTEGER DEFAULT 0,
    has_video INTEGER DEFAULT 0,
    has_json INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_events_year_month ON events(year, month);
  CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);

  CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year TEXT,
    month TEXT,
    files_synced INTEGER,
    events_synced INTEGER,
    started_at INTEGER,
    completed_at INTEGER,
    status TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sync_log_year_month ON sync_log(year, month, completed_at DESC);
`);

console.log('✅ Database initialized');

module.exports = db;
