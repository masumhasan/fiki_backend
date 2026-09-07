import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { uploadImageToS3 } from "../src/services/s3Service.js";

dotenv.config();

async function migrateUrl(url: string, category: string): Promise<string | null> {
  if (!url || !url.startsWith("http")) return null;
  console.log(`Migrating URL: ${url}`);
  try {
    let buffer: Buffer | null = null;
    let filename = path.basename(new URL(url).pathname);
    let ext = path.extname(filename).replace(/^\./, "").toLowerCase();
    let mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "pdf" ? "application/pdf" : "image/jpeg";

    // 1. Check local uploads path first
    const pathname = new URL(url).pathname; // e.g. /uploads/avatars/2026-09/...
    const localRel = pathname.replace(/^\//, "");
    const localPath = path.join(process.cwd(), localRel);

    if (fs.existsSync(localPath)) {
      console.log(`Found on local disk: ${localPath}`);
      buffer = fs.readFileSync(localPath);
    } else {
      // 2. Fetch from api.fikitransit.com
      const fetchUrl = url.includes("127.0.0.1") || url.includes("localhost")
        ? `https://api.fikitransit.com${pathname}`
        : url;
      console.log(`Fetching from remote: ${fetchUrl}`);
      const res = await fetch(fetchUrl);
      if (!res.ok) {
        console.error(`Failed to fetch ${fetchUrl}: ${res.statusText}`);
        return null;
      }
      const ab = await res.arrayBuffer();
      buffer = Buffer.from(ab);
    }

    if (!buffer) return null;
    const s3Url = await uploadImageToS3(buffer, filename, mimeType, category);
    console.log(`Successfully uploaded to S3: ${s3Url}`);
    return s3Url;
  } catch (err) {
    console.error(`Error migrating URL ${url}:`, err);
    return null;
  }
}

async function migrateBase64(base64: string, category: string, prefix: string): Promise<string | null> {
  if (!base64 || !base64.startsWith("data:")) return null;
  try {
    const mimeMatch = base64.match(/^data:([^;]+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : "image/png";
    const ext = mimeType.includes("pdf") ? "pdf" : mimeType.includes("png") ? "png" : "jpg";
    const clean = base64.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(clean, "base64");
    const filename = `${prefix}_${Date.now()}.${ext}`;
    const s3Url = await uploadImageToS3(buffer, filename, mimeType, category);
    console.log(`Migrated base64 to S3: ${s3Url}`);
    return s3Url;
  } catch (err) {
    console.error("Error migrating base64:", err);
    return null;
  }
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const db = mongoose.connection.db;
  if (!db) throw new Error("No database");

  // 1. DriverProfiles
  const profiles = await db.collection("driverprofiles").find({
    avatarUrl: { $regex: /^(http:\/\/127\.0\.0\.1|https?:\/\/api\.fikitransit\.com)/ }
  }).toArray();
  for (const p of profiles) {
    const newUrl = await migrateUrl(p.avatarUrl, "avatars");
    if (newUrl) {
      await db.collection("driverprofiles").updateOne(
        { _id: p._id },
        { $set: { avatarUrl: newUrl } }
      );
      console.log(`Updated DriverProfile ${p._id} avatarUrl to ${newUrl}`);
    }
  }

  // 2. Trips
  const trips = await db.collection("trips").find({
    $or: [
      { passengerAvatarUrl: { $regex: /^(http:\/\/127\.0\.0\.1|https?:\/\/api\.fikitransit\.com)/ } },
      { signature: { $regex: /^(http:\/\/127\.0\.0\.1|https?:\/\/api\.fikitransit\.com)/ } },
      { receiverSignature: { $regex: /^(http:\/\/127\.0\.0\.1|https?:\/\/api\.fikitransit\.com)/ } }
    ]
  }).toArray();
  for (const t of trips) {
    const update: any = {};
    if (t.passengerAvatarUrl?.match(/^(http:\/\/127\.0\.0\.1|https?:\/\/api\.fikitransit\.com)/)) {
      const u = await migrateUrl(t.passengerAvatarUrl, "passenger-avatars");
      if (u) update.passengerAvatarUrl = u;
    }
    if (t.signature?.match(/^(http:\/\/127\.0\.0\.1|https?:\/\/api\.fikitransit\.com)/)) {
      const u = await migrateUrl(t.signature, "signatures");
      if (u) update.signature = u;
    }
    if (t.receiverSignature?.match(/^(http:\/\/127\.0\.0\.1|https?:\/\/api\.fikitransit\.com)/)) {
      const u = await migrateUrl(t.receiverSignature, "signatures");
      if (u) update.receiverSignature = u;
    }
    if (Object.keys(update).length > 0) {
      await db.collection("trips").updateOne({ _id: t._id }, { $set: update });
      console.log(`Updated Trip ${t._id}:`, update);
    }
  }

  // 3. DriverApplications with base64
  const apps = await db.collection("driverapplications").find({
    $or: [
      { signature: { $regex: /^data:/ } },
      { bidForm: { $regex: /^data:/ } }
    ]
  }).toArray();
  for (const a of apps) {
    const update: any = {};
    if (a.signature?.startsWith("data:")) {
      const u = await migrateBase64(a.signature, "signatures", "signature");
      if (u) update.signature = u;
    }
    if (a.bidForm?.startsWith("data:")) {
      const u = await migrateBase64(a.bidForm, "driver-documents", "bid_form");
      if (u) update.bidForm = u;
    }
    if (Object.keys(update).length > 0) {
      await db.collection("driverapplications").updateOne({ _id: a._id }, { $set: update });
      console.log(`Updated DriverApplication ${a._id}:`, update);
    }
  }

  console.log("Migration complete!");
  await mongoose.disconnect();
}

run().catch(console.error);
