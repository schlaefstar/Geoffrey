const { PGlite } = require('@electric-sql/pglite');

async function testQueries() {
    const db = new PGlite('./pgdata');

    console.log('Testing query speeds...\n');

    // Test 1: Simple SELECT * FROM events LIMIT 10
    let start = Date.now();
    const simpleEvents = await db.query('SELECT * FROM events LIMIT 10');
    let elapsed = Date.now() - start;
    console.log(`1. SELECT * FROM events LIMIT 10: ${elapsed}ms`);

    // Test 2: Simple SELECT * FROM files LIMIT 10
    start = Date.now();
    const simpleFiles = await db.query('SELECT * FROM files LIMIT 10');
    elapsed = Date.now() - start;
    console.log(`2. SELECT * FROM files LIMIT 10: ${elapsed}ms`);

    // Test 3: Count events
    start = Date.now();
    const eventCount = await db.query('SELECT COUNT(*) FROM events');
    elapsed = Date.now() - start;
    console.log(`3. SELECT COUNT(*) FROM events: ${elapsed}ms (count: ${eventCount.rows[0].count})`);

    // Test 4: Count files
    start = Date.now();
    const fileCount = await db.query('SELECT COUNT(*) FROM files');
    elapsed = Date.now() - start;
    console.log(`4. SELECT COUNT(*) FROM files: ${elapsed}ms (count: ${fileCount.rows[0].count})`);

    // Test 5: The actual complex query (limit 10)
    start = Date.now();
    const complexQuery = await db.query(`
        SELECT
            e.*,
            COUNT(f.key) as file_count,
            COUNT(CASE WHEN f.file_type = 'video' THEN 1 END) as video_count,
            COUNT(CASE WHEN f.file_type = 'json' THEN 1 END) as json_count,
            COUNT(CASE WHEN f.file_type = 'jpg' THEN 1 END) as jpg_count,
            COUNT(CASE WHEN f.file_type = 'json.gz' THEN 1 END) as json_gz_count
        FROM events e
        LEFT JOIN files f ON e.event_id = f.event_id
        WHERE e.s3_prefix LIKE '%/2025/11/%'
        GROUP BY e.event_id
        ORDER BY e.timestamp DESC
        LIMIT 10
    `);
    elapsed = Date.now() - start;
    console.log(`5. Complex query with JOIN and aggregations (LIMIT 10): ${elapsed}ms`);

    // Test 6: Check for indexes
    const indexes = await db.query(`
        SELECT indexname, tablename, indexdef 
        FROM pg_indexes 
        WHERE schemaname = 'public'
    `);
    console.log(`\n6. Current indexes:`);
    indexes.rows.forEach(idx => {
        console.log(`   - ${idx.tablename}.${idx.indexname}`);
    });

    await db.close();
}

testQueries().catch(console.error);
