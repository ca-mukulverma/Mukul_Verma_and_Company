import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Compliance documents are kept in Cloudflare R2 (see docs/COMPLIANCE.md for
// the one-time setup). Browsers upload and download directly with short-lived
// signed links, so files never pass through Vercel's 4.5 MB request limit.

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET;

export function r2Configured() {
  return !!(accountId && accessKeyId && secretAccessKey && bucket);
}

let client: S3Client | null = null;
function r2() {
  if (!r2Configured()) throw new Error("Document storage (Cloudflare R2) is not set up yet");
  client ??= new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
  });
  return client;
}

// A link the browser PUTs the file to, valid for 10 minutes. The browser must
// send the same Content-Type (and Content-Encoding for gzipped files).
export async function uploadUrl(key: string, contentType: string, gzipped: boolean) {
  return getSignedUrl(
    r2(),
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ...(gzipped && { ContentEncoding: "gzip" }) }),
    { expiresIn: 600 }
  );
}

// A download link; R2 sends gzipped files with Content-Encoding: gzip, so the
// browser saves them unpacked
export async function downloadUrl(key: string, fileName: string, expiresIn = 300) {
  return getSignedUrl(
    r2(),
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${fileName.replace(/["\\\r\n]/g, "")}"`,
    }),
    { expiresIn }
  );
}

// Size of a stored object, or null if it isn't there
export async function objectSize(key: string): Promise<number | null> {
  try {
    const head = await r2().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return head.ContentLength ?? null;
  } catch {
    return null;
  }
}

// The stored bytes (still gzipped for gzipped files)
export async function readObject(key: string): Promise<Buffer> {
  const result = await r2().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await result.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

export async function deleteObject(key: string) {
  await r2().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
