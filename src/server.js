require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API: Get database stats
app.get('/api/stats', (req, res) => {
  const totalEvents = db.prepare('SELECT COUNT(*) as count FROM events').get();
  const totalByYear = db.prepare(`
    SELECT year, COUNT(*) as count
    FROM events
    GROUP BY year
    ORDER BY year DESC
  `).all();

  const recentSyncs = db.prepare(`
    SELECT year, month, files_synced, events_synced,
           datetime(completed_at, 'unixepoch') as completed_at
    FROM sync_log
    WHERE status = 'completed'
    ORDER BY completed_at DESC
    LIMIT 10
  `).all();

  const eventsByMonth = db.prepare(`
    SELECT year, month, COUNT(*) as count,
           SUM(has_video) as videos,
           SUM(has_json) as jsons
    FROM events
    GROUP BY year, month
    ORDER BY year DESC, month DESC
    LIMIT 12
  `).all();

  res.json({
    total: totalEvents.count,
    byYear: totalByYear,
    byMonth: eventsByMonth,
    recentSyncs
  });
});

// API: Get events for a specific year/month
app.get('/api/events/:year/:month', (req, res) => {
  const { year, month } = req.params;
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;

  const events = db.prepare(`
    SELECT *
    FROM events
    WHERE year = ? AND month = ?
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `).all(year, month, limit, offset);

  const total = db.prepare(`
    SELECT COUNT(*) as count
    FROM events
    WHERE year = ? AND month = ?
  `).get(year, month);

  res.json({
    events,
    total: total.count,
    limit,
    offset
  });
});

app.listen(PORT, () => {
  console.log(`\n🚪 Geoffrey running at http://localhost:${PORT}`);
  console.log(`📊 View stats at http://localhost:${PORT}\n`);
});
