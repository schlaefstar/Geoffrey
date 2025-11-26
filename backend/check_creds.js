const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const dotenv = require('dotenv');

// Load env
dotenv.config();

const BUCKET_NAME = 'ml-training-data-vision';
const REGION = 'us-east-1';

async function checkCreds() {
    console.log('🔍 Checking AWS Credentials...');
    console.log(`   Access Key ID: ${process.env.AWS_ACCESS_KEY_ID ? '****' + process.env.AWS_ACCESS_KEY_ID.slice(-4) : 'MISSING'}`);
    console.log(`   Bucket: ${BUCKET_NAME}`);

    const client = new S3Client({
        region: REGION,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            sessionToken: process.env.AWS_SESSION_TOKEN,
        },
    });

    try {
        const command = new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            MaxKeys: 1
        });
        await client.send(command);
        console.log('\n✅ Credentials are WORKING! You can access S3.');
    } catch (error) {
        console.error('\n❌ Credentials FAILED!');
        console.error(`   Error: ${error.message}`);
        if (error.name === 'ExpiredToken') {
            console.error('   Reason: The session token has expired.');
        }
        process.exit(1);
    }
}

checkCreds();
