// Private document storage adapter. When S3_BUCKET (+S3_REGION, optional
// S3_ENDPOINT for R2/MinIO) is set, uploads stream to the bucket; otherwise
// files stay in the local uploads dir. Nothing in either mode produces a
// public URL — reads always go through the signature-checked /file route.
const fs = require('fs');
const path = require('path');

const LOCAL_DIR = process.env.DOCUMENT_STORAGE_DIR || path.join(process.cwd(), 'var', 'uploads');

const S3_BUCKET = process.env.S3_BUCKET || '';
const s3 = S3_BUCKET ? new (require('@aws-sdk/client-s3').S3Client)({
  region: process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT || undefined,
  forcePathStyle: Boolean(process.env.S3_ENDPOINT), // R2/MinIO style
}) : null;

const usingS3 = () => Boolean(s3);

async function put(fileKey, buf, contentType = 'application/pdf') {
  if (!s3) {
    const full = path.join(LOCAL_DIR, fileKey);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buf);
    return full; // local path (scanner + streaming use it)
  }
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  await s3.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: fileKey, Body: buf, ContentType: contentType }));
  return null;
}

// Stream a stored object to an express response; returns false if missing.
async function pipe(fileKey, res) {
  if (!s3) {
    const full = path.join(LOCAL_DIR, fileKey);
    if (!full.startsWith(LOCAL_DIR) || !fs.existsSync(full)) return false;
    fs.createReadStream(full).pipe(res);
    return true;
  }
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: fileKey }));
    out.Body.pipe(res);
    return true;
  } catch (e) {
    if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return false;
    throw e;
  }
}

async function remove(fileKey) {
  if (!s3) {
    const full = path.join(LOCAL_DIR, fileKey);
    if (full.startsWith(LOCAL_DIR)) fs.rmSync(full, { force: true });
    return;
  }
  const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
  await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: fileKey })).catch(() => {});
}

module.exports = { put, pipe, remove, usingS3, LOCAL_DIR };
