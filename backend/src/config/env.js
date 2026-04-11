const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const candidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(__dirname, "../../.env"),
  path.resolve(__dirname, "../../../.env")
];

for (const file of candidates) {
  if (fs.existsSync(file)) {
    dotenv.config({ path: file });
  }
}

const env = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL,
  frontendUrl: process.env.FRONTEND_URL || "http://127.0.0.1:5173",
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  smtpFrom: process.env.SMTP_FROM || "",
  awsRegion: process.env.AWS_REGION || "",
  s3Bucket: process.env.S3_BUCKET || "",
  maxUploadSizeBytes: Number(process.env.MAX_UPLOAD_SIZE_BYTES || 10 * 1024 * 1024)
};

if (!env.databaseUrl) {
  throw new Error("DATABASE_URL is required. Add it to backend/.env or C:\\ExamIntegritySystem\\.env.");
}

module.exports = env;
