export interface S3File {
    key: string;
    lastModified: Date;
    size: number;
    type: 'video' | 'json' | 'json.gz' | 'jpg' | 'other';
    eventId: string;
    isDownloaded?: boolean;
    localPath?: string;
}

export interface EventMetadata {
    eventId: string;        // Numeric only (3rd segment)
    userId: string;         // 1st segment
    deviceId: string;       // 2nd segment
    cameraModel: string;    // 4th segment
    timestamp: Date;        // Parsed from 5th segment
    fileCount: number;
    fileTypes: {
        video: number;
        json: number;
        jpg: number;
        jsonGz: number;
    };
    files: S3File[];
    status?: string;
}
