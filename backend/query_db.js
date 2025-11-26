const { PGlite } = require('@electric-sql/pglite');

async function queryDB() {
    const db = new PGlite('./pgdata');

    console.log('\n=== EVENTS TABLE (LIMIT 10) ===');
    const events = await db.query('SELECT * FROM events LIMIT 10');
    console.table(events.rows);

    console.log('\n=== FILES TABLE (LIMIT 10) ===');
    const files = await db.query('SELECT * FROM files LIMIT 10');
    console.table(files.rows);

    console.log('\n=== SYNC STATUS TABLE ===');
    const syncStatus = await db.query('SELECT * FROM sync_status');
    console.table(syncStatus.rows);

    console.log('\n=== TABLE COUNTS ===');
    const eventCount = await db.query('SELECT COUNT(*) as count FROM events');
    const fileCount = await db.query('SELECT COUNT(*) as count FROM files');
    console.log(`Events: ${eventCount.rows[0].count}`);
    console.log(`Files: ${fileCount.rows[0].count}`);

    await db.close();
}

queryDB().catch(console.error);
