const { PGlite } = require('@electric-sql/pglite');
const path = require('path');

async function runTelemetry() {
    const db = new PGlite('./pgdata');
    console.log('\n=== DATABASE TELEMETRY ===\n');

    try {
        // 1. Total Counts
        const eventCount = await db.query('SELECT COUNT(*) FROM events');
        const fileCount = await db.query('SELECT COUNT(*) FROM files');
        console.log(`Total Events: ${eventCount.rows[0].count}`);
        console.log(`Total Files:  ${fileCount.rows[0].count}`);
        console.log('----------------------------------------');

        // 2. Unique Users & Devices
        const userCount = await db.query('SELECT COUNT(DISTINCT user_id) FROM events');
        const deviceCount = await db.query('SELECT COUNT(DISTINCT device_id) FROM events');
        console.log(`Unique Users:   ${userCount.rows[0].count}`);
        console.log(`Unique Devices: ${deviceCount.rows[0].count}`);
        console.log('----------------------------------------');

        // 3. Breakdown by Month (derived from timestamp)
        console.log('Events by Month:');
        const monthlyStats = await db.query(`
            SELECT 
                TO_CHAR(timestamp, 'YYYY-MM') as month,
                COUNT(*) as count
            FROM events
            GROUP BY month
            ORDER BY month DESC
        `);
        monthlyStats.rows.forEach(row => {
            console.log(`  ${row.month}: ${row.count}`);
        });
        console.log('----------------------------------------');

        // 4. File Types Breakdown
        console.log('File Types:');
        const fileTypes = await db.query(`
            SELECT file_type, COUNT(*) as count
            FROM files
            GROUP BY file_type
            ORDER BY count DESC
        `);
        fileTypes.rows.forEach(row => {
            console.log(`  ${row.file_type}: ${row.count}`);
        });

    } catch (error) {
        console.error('Error running telemetry:', error);
    } finally {
        await db.close();
    }
}

runTelemetry();
