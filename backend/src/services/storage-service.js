const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const env = require("../config/env");

let s3Client = null;

function isStorageConfigured() {
  return Boolean(env.awsRegion && env.s3Bucket);
}

function getS3Client() {
  if (!isStorageConfigured()) {
    throw new Error("S3 is not configured. Add AWS_REGION and S3_BUCKET to the backend environment.");
  }

  if (!s3Client) {
    s3Client = new S3Client({ region: env.awsRegion });
  }

  return s3Client;
}

async function uploadBuffer({ key, body, contentType, metadata = {} }) {
  const client = getS3Client();
  await client.send(new PutObjectCommand({
    Bucket: env.s3Bucket,
    Key: key,
    Body: body,
    ContentType: contentType || "application/octet-stream",
    Metadata: Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null).map(([name, value]) => [name, String(value)]))
  }));

  return { bucket: env.s3Bucket, key };
}

async function createDownloadUrl(key, expiresIn = 900) {
  const client = getS3Client();
  return getSignedUrl(client, new GetObjectCommand({
    Bucket: env.s3Bucket,
    Key: key
  }), { expiresIn });
}

async function removeObject(key) {
  const client = getS3Client();
  await client.send(new DeleteObjectCommand({
    Bucket: env.s3Bucket,
    Key: key
  }));
}

module.exports = {
  isStorageConfigured,
  uploadBuffer,
  createDownloadUrl,
  removeObject
};
