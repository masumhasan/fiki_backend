import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

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

export async function uploadImageToS3(
  fileBuffer: Buffer,
  originalName: string,
  mimeType: string,
  folder = "vehicle-photos"
): Promise<string> {
  try {
    const extension = originalName.includes(".") ? originalName.split(".").pop() : "jpg";
    const key = `${folder}/${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${extension}`;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: mimeType,
    });

    await s3Client.send(command);

    // Standard S3 URL
    return `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
  } catch (error) {
    console.error("AWS S3 Upload Error:", error);
    // Fallback inline data URI if S3 fails (e.g. expired STS session token)
    const base64 = fileBuffer.toString("base64");
    return `data:${mimeType};base64,${base64}`;
  }
}
