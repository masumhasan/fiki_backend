import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import crypto from "crypto";

const bucketName = process.env.AWS_BUCKET_NAME || "fiki-400658575804-us-east-1-an";
const region = process.env.AWS_REGION || "us-east-1";

export const s3Client = new S3Client({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    sessionToken: process.env.AWS_SESSION_TOKEN || undefined,
  },
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

export async function uploadImageToS3(
  fileBuffer: Buffer,
  originalName: string,
  mimeType: string,
  category = "shift-odometers"
): Promise<string> {
  try {
    const key = generateStructuredS3Key(category, originalName, mimeType);

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: mimeType,
    });

    await s3Client.send(command);

    // Return standard public S3 URL
    return `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
  } catch (error) {
    console.error("AWS S3 Upload Error:", error);
    // Fallback inline data URI if S3 fails (e.g. expired STS session token)
    const base64 = fileBuffer.toString("base64");
    return `data:${mimeType};base64,${base64}`;
  }
}
