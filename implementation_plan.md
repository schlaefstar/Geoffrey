# Geoffrey Web App - Implementation Plan

## Goal
Build a local web application to browse and retrieve files from an S3 bucket. The files represent user feedback events.

## User Review Required
> [!IMPORTANT]
> **S3 Credentials**: I need the S3 credentials (Access Key, Secret Key, Bucket Name, Region) to connect. Please provide them via a `.env` file (I will create a template).
> **Connection Document**: You mentioned a document outlining how to connect. Please share this so I can understand the specific directory structure and any custom logic needed.

## Proposed Changes

### Project Structure
I will initialize a **Vite + React + TypeScript** application. This provides a fast, modern development environment suitable for a local web app.

### Dependencies
- `aws-sdk` (or `@aws-sdk/client-s3`): For communicating with S3.
- `dotenv`: To manage environment variables (built-in with Vite for `VITE_` prefixed vars).

### S3 Configuration
- **Bucket**: `ml-training-data-vision`
- **Path Prefix**: `us-prod/submitted/video/`
- **Structure**: `/{year}/{month}/...` containing `.mp4`, `.json`, `.json.gz`, and `.jpg` files.

### Components

#### [NEW] [frontend](file:///Users/schlaefers/Desktop/Chamberlain/Geoffrey/frontend)
I will create a `frontend` directory for the web app.

- `frontend/.env.local`: File for storing sensitive credentials (gitignored).
    - `VITE_AWS_ACCESS_KEY_ID`
    - `VITE_AWS_SECRET_ACCESS_KEY`
    - `VITE_AWS_REGION` (Default: `us-east-1`)
    - `VITE_S3_BUCKET_NAME` (Default: `ml-training-data-vision`)
- `frontend/src/services/s3.ts`: Service to handle S3 authentication and file listing/fetching.
- `frontend/src/App.tsx`: Main UI to display the file list, organized by date (Year/Month).

## Verification Plan

### Automated Tests
- Verify the app builds successfully.
- Verify S3 client initializes with provided credentials.

### Manual Verification
- User will need to populate `.env.local` with real credentials.
- Run `npm run dev` and verify the file list loads from the bucket.
