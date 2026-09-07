import crypto from "crypto";
import fs from "fs";
import path from "path";
import { uploadImageToS3 } from "../services/s3Service.js";

// In-memory cache for deduplication
const s3UploadCache = new Map<string, string>();

export function isBase64Media(str: any): boolean {
  if (typeof str !== "string") return false;
  return (
    str.startsWith("data:image/") ||
    str.startsWith("data:application/pdf") ||
    (/^[A-Za-z0-9+/=]+$/.test(str.slice(0, 100)) && str.length > 500)
  );
}

export function getMimeTypeFromBase64(base64: string): string {
  const match = base64.match(/^data:([^;]+);base64,/);
  return match ? match[1] : "image/jpeg";
}

export function cleanBase64ToBuffer(base64: string): Buffer {
  const clean = base64.replace(/^data:[^;]+;base64,/, "");
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

  // 1. If it's already an AWS S3 URL, return as-is
  if (trimmed.includes(".amazonaws.com/")) {
    return trimmed;
  }

  // 2. If it's a local / uploads URL or relative path, migrate to S3
  const isLocalUpload =
    trimmed.includes("/uploads/") ||
    trimmed.startsWith("uploads/") ||
    trimmed.includes("127.0.0.1:5000") ||
    trimmed.includes("localhost:5000") ||
    trimmed.includes("api.fikitransit.com/uploads");

  if (isLocalUpload) {
    try {
      let buffer: Buffer | null = null;
      let filename = `${fileNamePrefix}_${Date.now()}.jpg`;
      let mimeType = "image/jpeg";

      // Check local disk first
      const uploadsIdx = trimmed.indexOf("uploads/");
      if (uploadsIdx !== -1) {
        const relPath = trimmed.substring(uploadsIdx);
        const localPath = path.join(process.cwd(), relPath);
        if (fs.existsSync(localPath)) {
          buffer = fs.readFileSync(localPath);
          filename = path.basename(relPath);
          const ext = path.extname(filename).replace(/^\./, "").toLowerCase();
          mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "pdf" ? "application/pdf" : "image/jpeg";
        }
      }

      // If not on local disk, fetch if it's an HTTP URL
      if (!buffer && (trimmed.startsWith("http://") || trimmed.startsWith("https://"))) {
        const fetchUrl = (trimmed.includes("127.0.0.1") || trimmed.includes("localhost"))
          ? trimmed.replace(/http:\/\/(127\.0\.0\.1|localhost):5000/, "https://api.fikitransit.com")
          : trimmed;
        const res = await fetch(fetchUrl);
        if (res.ok) {
          const ab = await res.arrayBuffer();
          buffer = Buffer.from(ab);
          const urlObj = new URL(fetchUrl);
          filename = path.basename(urlObj.pathname);
          const ext = path.extname(filename).replace(/^\./, "").toLowerCase();
          mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "pdf" ? "application/pdf" : "image/jpeg";
        }
      }

      if (buffer) {
        const s3Url = await uploadImageToS3(buffer, filename, mimeType, category);
        if (s3Url && s3Url.includes(".amazonaws.com/")) {
          return s3Url;
        }
      }
    } catch (localMigrateErr) {
      console.warn("Failed to auto-migrate local upload to S3:", trimmed, localMigrateErr);
    }
  }

  // 3. If it's a legitimate remote external URL (e.g., google profile photo, ui-avatars), return as-is
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  // 4. Check if it's base64 data
  if (isBase64Media(trimmed)) {
    const mimeType = getMimeTypeFromBase64(trimmed);
    const buffer = cleanBase64ToBuffer(trimmed);

    // Check in-memory hash cache for deduplication
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    if (s3UploadCache.has(hash)) {
      return s3UploadCache.get(hash)!;
    }

    const ext = mimeType.includes("pdf") ? "pdf" : mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
    const fileName = `${fileNamePrefix}_${Date.now()}.${ext}`;
    const s3Url = await uploadImageToS3(buffer, fileName, mimeType, category);

    if (s3Url && !s3Url.startsWith("data:")) {
      s3UploadCache.set(hash, s3Url);
      return s3Url;
    }
  }

  return value;
}
