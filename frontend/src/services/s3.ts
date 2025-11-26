const API_BASE = 'http://localhost:3001/api';

export interface S3File {
    key: string;
    size: number;
    lastModified: Date;
    type: 'video' | 'json' | 'json.gz' | 'jpg' | 'other';
}

export async function listFiles(year: string, month: string, continuationToken?: string): Promise<{
    files: S3File[];
    nextContinuationToken: string | null;
    isTruncated: boolean;
}> {
    const url = new URL(`${API_BASE}/years/${year}/months/${month}/files`);
    if (continuationToken) {
        url.searchParams.set('continuationToken', continuationToken);
    }

    const response = await fetch(url.toString());

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch files');
    }

    const data = await response.json();

    // Convert lastModified strings to Date objects
    const files = data.files.map((file: any) => ({
        ...file,
        lastModified: new Date(file.lastModified),
    }));

    return {
        files,
        nextContinuationToken: data.nextContinuationToken,
        isTruncated: data.isTruncated,
    };
}

// Sync events from S3 to local DB
export async function syncEvents(year: string, month: string, force: boolean = false) {
    const response = await fetch(`${API_BASE}/sync`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ year, month, force }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Sync failed');
    }

    return response.json();
}

// Get sync status
export async function getSyncStatus(year: string, month: string) {
    const response = await fetch(`${API_BASE}/sync/status?year=${year}&month=${month}`);
    if (!response.ok) {
        throw new Error('Failed to fetch sync status');
    }
    return response.json();
}

// Get events from local DB
export async function getEvents(year: string, month: string, sortColumn: string = 'timestamp', sortDirection: string = 'desc') {
    const response = await fetch(`${API_BASE}/events?year=${year}&month=${month}&sort=${sortColumn}&dir=${sortDirection}`);
    if (!response.ok) {
        throw new Error('Failed to fetch events');
    }
    return response.json();
}

// Download event files to backend
export async function downloadEvent(year: string, month: string, eventId: string) {
    const response = await fetch(`${API_BASE}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, eventId }),
    });

    if (!response.ok) {
        throw new Error('Failed to download event');
    }

    return response.json();
}

export async function listYears(): Promise<string[]> {
    const response = await fetch(`${API_BASE}/years`);

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch years');
    }

    return response.json();
}

export async function listMonths(year: string): Promise<string[]> {
    const response = await fetch(`${API_BASE}/years/${year}/months`);

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch months');
    }

    return response.json();
}

export async function getPresignedUrl(key: string): Promise<string> {
    // For now, construct a simple S3 URL
    return `https://ml-training-data-vision.s3.us-east-1.amazonaws.com/${key}`;
}

// Check if event is downloaded
export async function checkDownloadStatus(year: string, month: string, eventId: string) {
    const response = await fetch(`${API_BASE}/downloads/${year}/${month}/${eventId}`);

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to check download status');
    }

    return response.json();
}

// Get local file URL
export function getLocalFileUrl(year: string, month: string, eventId: string, filename: string): string {
    return `${API_BASE}/files/${year}/${month}/${eventId}/${filename}`;
}

// Delete downloaded event
export async function deleteDownload(year: string, month: string, eventId: string) {
    const response = await fetch(`${API_BASE}/downloads/${year}/${month}/${eventId}`, {
        method: 'DELETE',
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete download');
    }

    return response.json();
}
