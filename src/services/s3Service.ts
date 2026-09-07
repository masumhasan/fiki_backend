import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

export function getS3Client(): S3Client {
  const region = process.env.AWS_REGION || "us-east-1";
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim() || "";
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim() || "";
  const sessionToken = process.env.AWS_SESSION_TOKEN?.trim();

  return new S3Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {}),
    },
  });
}

// Proxied S3Client so any caller gets live credentials from process.env
export const s3Client = new Proxy({} as S3Client, {
  get: (_target, prop) => (getS3Client() as any)[prop],
});

function sanitizeExtension(originalName: string, mimeType: string): string {
  let ext = "";
  if (originalName && originalName.includes(".")) {
    ext = originalName.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
  }
  if (!ext || ext.length > 5) {
    if (mimeType.includes("png")) ext = "png";
    else if (mimeType.includes("webp")) ext = "webp";
    else if (mimeType.includes("gif")) ext = "gif";
    else ext = "jpg";
  }
  return ext;
}

export function generateStructuredS3Key(
  category = "shift-odometers",
  originalName = "photo.jpg",
  mimeType = "image/jpeg"
): string {
  // 1. Sanitize Category (e.g. shift-odometers, signatures, driver-documents)
  const safeCategory = category.toLowerCase().replace(/[^a-z0-9_-]/g, "") || "vehicle-photos";

  // 2. Date subfolder slug: YYYY-MM
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const dateFolder = `${year}-${month}`;

  // 3. Timestamp slug: YYYYMMDD_HHmmss
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const timestampSlug = `${year}${month}${day}_${hours}${minutes}${seconds}`;

  // 4. Random cryptographic suffix
  const randomSuffix = crypto.randomBytes(4).toString("hex");

  // 5. Sanitize extension
  const ext = sanitizeExtension(originalName, mimeType);

  // 6. Build clean structured filename: <category>_<timestamp>_<random>.<ext>
  const cleanPrefix = safeCategory.replace(/s$/, ""); // e.g. shift-odometers -> shift-odometer
  const filename = `${cleanPrefix}_${timestampSlug}_${randomSuffix}.${ext}`;

  // S3 path: uploads/<category>/<YYYY-MM>/<filename>
  return `uploads/${safeCategory}/${dateFolder}/${filename}`;
}

export function getBaseUrl(customBaseUrl?: string): string {
  if (customBaseUrl && !customBaseUrl.includes("localhost") && !customBaseUrl.includes("127.0.0.1")) {
    return customBaseUrl.replace(/\/$/, "");
  }
  if (process.env.BASE_URL && !process.env.BASE_URL.includes("localhost") && !process.env.BASE_URL.includes("127.0.0.1")) {
    return process.env.BASE_URL.replace(/\/$/, "");
  }
  if (process.env.BACKEND_URL && !process.env.BACKEND_URL.includes("localhost") && !process.env.BACKEND_URL.includes("127.0.0.1")) {
    return process.env.BACKEND_URL.replace(/\/$/, "");
  }
  return "https://api.fikitransit.com";
}

export function saveFileLocally(fileBuffer: Buffer, relativeKey: string, customBaseUrl?: string): string {
  const fullPath = path.join(process.cwd(), relativeKey);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(fullPath, fileBuffer);

  const baseUrl = getBaseUrl(customBaseUrl);
  const cleanPath = relativeKey.startsWith("/") ? relativeKey : `/${relativeKey}`;
  return `${baseUrl}${cleanPath}`;
}

export async function uploadImageToS3(
  fileBuffer: Buffer,
  originalName: string,
  mimeType: string,
  category = "shift-odometers",
  customBaseUrl?: string
): Promise<string> {
  const key = generateStructuredS3Key(category, originalName, mimeType);

  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();

  // If credentials are completely empty, save directly to local disk
  if (!accessKeyId || !secretAccessKey) {
    return saveFileLocally(fileBuffer, key, customBaseUrl);
  }

  try {
    const bucketName = process.env.AWS_BUCKET_NAME || "fiki-400658575804-us-east-1-an";
    const region = process.env.AWS_REGION || "us-east-1";
    const client = getS3Client();

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: mimeType,
    });

    await client.send(command);

    // Return standard public S3 URL
    return `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
  } catch (error) {
    console.warn(`AWS S3 Upload failed, saving locally instead (${key}):`, (error as any)?.message || error);
    // Reliable disk fallback: Save to local uploads folder and return HTTP URL
    try {
      return saveFileLocally(fileBuffer, key, customBaseUrl);
    } catch (saveError) {
      console.error("Local file save error:", saveError);
      throw new Error(`Failed to upload file to S3 and failed local fallback: ${(saveError as any)?.message || saveError}`);
    }
  }
}
