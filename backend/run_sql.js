const { PGlite } = require('@electric-sql/pglite');

async function runQuery() {
    // Get query from command line arguments
    const query = process.argv[2];

    if (!query) {
        console.error('Usage: node run_sql.js "SELECT * FROM events LIMIT 5"');
        process.exit(1);
    }

    const db = new PGlite('./pgdata');

    try {
        const start = Date.now();
        const result = await db.query(query);
        const elapsed = Date.now() - start;

        console.log(`\nQuery executed in ${elapsed}ms\n`);

        if (result.rows.length === 0) {
            console.log('No results found.');
        } else {
            console.table(result.rows);
            console.log(`\nRows returned: ${result.rows.length}`);
        }

    } catch (error) {
        console.error('\n❌ Query failed:', error.message);
    } finally {
        await db.close();
    }
}

runQuery();
