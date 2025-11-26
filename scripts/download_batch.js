// scripts/download_batch.js
// This script downloads a batch of events (default 100) for a given year and month.
// It uses the backend API to list files, groups them by event ID, and calls the download endpoint.

const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const API_BASE = 'http://localhost:3001/api';

async function listFiles(year, month, continuationToken = null) {
    const url = new URL(`${API_BASE}/years/${year}/months/${month}/files`);
    if (continuationToken) {
        url.searchParams.set('continuationToken', continuationToken);
    }
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('Failed to list files');
    return await res.json();
}

async function downloadEvent(year, month, eventId, files) {
    const res = await fetch(`${API_BASE}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, eventId, files }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Download failed');
    }
    return await res.json();
}

async function main() {
    const year = process.argv[2] || '2025';
    const month = process.argv[3] || '11';
    const limit = parseInt(process.argv[4] || '100', 10);

    console.log(`Downloading up to ${limit} events for ${year}/${month}`);

    let continuation = null;
    const allFiles = [];
    // Gather files until we have enough to cover the limit of events
    while (true) {
        const { files, nextContinuationToken, isTruncated } = await listFiles(year, month, continuation);
        allFiles.push(...files);
        if (allFiles.length >= limit * 10 || !isTruncated) break; // rough estimate
        continuation = nextContinuationToken;
    }

    // Group by event ID (prefix before first underscore)
    const groups = {};
    for (const f of allFiles) {
        const filename = f.key.split('/').pop();
        const match = filename.match(/^(.+?)_/);
        const eventId = match ? match[1] : filename;
        if (!groups[eventId]) groups[eventId] = [];
        groups[eventId].push(f);
    }

    const eventIds = Object.keys(groups).slice(0, limit);
    console.log(`Found ${eventIds.length} events to download`);

    for (const eventId of eventIds) {
        try {
            const result = await downloadEvent(year, month, eventId, groups[eventId]);
            console.log(`✅ Downloaded event ${eventId}: ${result.downloadedFiles.length} files`);
        } catch (e) {
            console.error(`❌ Failed event ${eventId}:`, e.message);
        }
    }

    console.log('Batch download complete');
}

main().catch(err => console.error('Fatal error:', err));
