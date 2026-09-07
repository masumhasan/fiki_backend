import crypto from "crypto";
import { uploadImageToS3 } from "../services/s3Service.js";

// In-memory cache for deduplication
const s3UploadCache = new Map<string, string>();

export function isBase64Image(str: any): boolean {
  if (typeof str !== "string") return false;
  return (
    str.startsWith("data:image/") ||
    (/^[A-Za-z0-9+/=]+$/.test(str.slice(0, 100)) && str.length > 500)
  );
}

export function getMimeTypeFromBase64(base64: string): string {
  const match = base64.match(/^data:(image\/\w+);base64,/);
  return match ? match[1] : "image/jpeg";
}

export function cleanBase64ToBuffer(base64: string): Buffer {
  const clean = base64.replace(/^data:image\/\w+;base64,/, "");
  return Buffer.from(clean, "base64");
}

export async function ensureS3Image(
  value: string | undefined | null,
  category = "general",
  fileNamePrefix = "image"
): Promise<string | undefined | null> {
  if (!value) return value;
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  // If it's already an HTTP / HTTPS URL, return as-is
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  // Check if it's base64 data
  if (isBase64Image(trimmed)) {
    const mimeType = getMimeTypeFromBase64(trimmed);
    const buffer = cleanBase64ToBuffer(trimmed);

    // Check in-memory hash cache for deduplication
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    if (s3UploadCache.has(hash)) {
      return s3UploadCache.get(hash)!;
    }

    const ext = mimeType.split("/")[1] || "jpg";
    const fileName = `${fileNamePrefix}_${Date.now()}.${ext}`;
    const s3Url = await uploadImageToS3(buffer, fileName, mimeType, category);

    if (s3Url && !s3Url.startsWith("data:image/")) {
      s3UploadCache.set(hash, s3Url);
      return s3Url;
    }
  }

  return value;
}
