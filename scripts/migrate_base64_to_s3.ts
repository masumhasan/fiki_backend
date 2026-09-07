import mongoose from "mongoose";
import dotenv from "dotenv";
import crypto from "crypto";
import { User } from "../src/models/User.js";
import { Trip } from "../src/models/Trip.js";
import { DriverShift } from "../src/models/DriverShift.js";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });

const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/fiki-transit";

function getMimeType(base64: string): string {
  const match = base64.match(/^data:(image\/\w+);base64,/);
  return match ? match[1] : "image/jpeg";
}

function base64ToBuffer(base64: string): Buffer {
  const cleanBase64 = base64.replace(/^data:image\/\w+;base64,/, "");
  return Buffer.from(cleanBase64, "base64");
}

// In-memory deduplication cache: sha256 -> s3Url
const uploadCache = new Map<string, string>();

async function uploadBase64Field(base64: string, category: string): Promise<string> {
  const mimeType = getMimeType(base64);
  const buffer = base64ToBuffer(base64);

  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  if (uploadCache.has(hash)) {
    return uploadCache.get(hash)!;
  }

  const ext = mimeType.split("/")[1] || "jpg";
  const fileName = `migration_${Date.now()}_${crypto.randomBytes(3).toString("hex")}.${ext}`;
  const { uploadImageToS3 } = await import("../src/services/s3Service.js");
  const url = await uploadImageToS3(buffer, fileName, mimeType, category);

  if (url && !url.startsWith("data:image/")) {
    uploadCache.set(hash, url);
  }
  return url;
}

async function migrate() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGO_URI);
  console.log("Connected to DB.");

  let totalMigrated = 0;

  // 1. Migrate Users (avatarUrl)
  console.log("\n--- Scanning Users ---");
  const users = await User.find({ avatarUrl: { $regex: /^data:image\// } });
  console.log(`Found ${users.length} users with base64 avatarUrl.`);
  for (const user of users) {
    if (user.avatarUrl && user.avatarUrl.startsWith("data:image/")) {
      try {
        const url = await uploadBase64Field(user.avatarUrl, "user-avatars");
        user.avatarUrl = url;
        await user.save();
        totalMigrated++;
        console.log(`✓ Migrated avatar for user ${user._id}`);
      } catch (e: any) {
        console.error(`Failed to upload avatar for user ${user._id}: ${e.message}`);
      }
    }
  }

  // 2. Migrate Trips (signature, receiverSignature, passengerAvatarUrl)
  console.log("\n--- Scanning Trips with Cursor ---");
  const base64Regex = /^data:image\//;
  const cursor = Trip.find({
    $or: [
      { signature: { $regex: base64Regex } },
      { receiverSignature: { $regex: base64Regex } },
      { passengerAvatarUrl: { $regex: base64Regex } },
    ],
  })
    .select("_id signature receiverSignature passengerAvatarUrl")
    .cursor({ batchSize: 20 });

  let processedCount = 0;
  for await (const trip of cursor) {
    const updateFields: Record<string, string> = {};

    if (trip.signature && trip.signature.startsWith("data:image/")) {
      try {
        updateFields.signature = await uploadBase64Field(trip.signature, "signatures");
      } catch (e: any) {
        console.error(`Trip ${trip._id} signature error: ${e.message}`);
      }
    }

    if (trip.receiverSignature && trip.receiverSignature.startsWith("data:image/")) {
      try {
        updateFields.receiverSignature = await uploadBase64Field(trip.receiverSignature, "signatures");
      } catch (e: any) {
        console.error(`Trip ${trip._id} receiverSignature error: ${e.message}`);
      }
    }

    if (trip.passengerAvatarUrl && trip.passengerAvatarUrl.startsWith("data:image/")) {
      try {
        updateFields.passengerAvatarUrl = await uploadBase64Field(trip.passengerAvatarUrl, "passenger-avatars");
      } catch (e: any) {
        console.error(`Trip ${trip._id} passengerAvatarUrl error: ${e.message}`);
      }
    }

    if (Object.keys(updateFields).length > 0) {
      await Trip.updateOne({ _id: trip._id }, { $set: updateFields });
      totalMigrated++;
    }
    processedCount++;
    if (processedCount % 10 === 0 || processedCount === 1) {
      console.log(`Processed ${processedCount} trips... (Unique S3 uploads: ${uploadCache.size})`);
    }
  }
  console.log(`Completed trip migration. Total trips processed: ${processedCount}`);

  // 3. Migrate DriverShifts (startPhotoUrl, endPhotoUrl, startPhotoUrls, endPhotoUrls)
  console.log("\n--- Scanning DriverShifts ---");
  const shifts = await DriverShift.find({
    $or: [
      { startPhotoUrl: { $regex: base64Regex } },
      { endPhotoUrl: { $regex: base64Regex } },
      { startPhotoUrls: { $regex: base64Regex } },
      { endPhotoUrls: { $regex: base64Regex } },
    ],
  }).select("_id startPhotoUrl endPhotoUrl startPhotoUrls endPhotoUrls");
  console.log(`Found ${shifts.length} DriverShifts with base64 fields.`);
  for (const shift of shifts) {
    const updateFields: Record<string, any> = {};

    if (shift.startPhotoUrl && shift.startPhotoUrl.startsWith("data:image/")) {
      try {
        updateFields.startPhotoUrl = await uploadBase64Field(shift.startPhotoUrl, "shift-odometers");
      } catch (e: any) {
        console.error(e.message);
      }
    }

    if (shift.endPhotoUrl && shift.endPhotoUrl.startsWith("data:image/")) {
      try {
        updateFields.endPhotoUrl = await uploadBase64Field(shift.endPhotoUrl, "shift-odometers");
      } catch (e: any) {
        console.error(e.message);
      }
    }

    if (shift.startPhotoUrls && shift.startPhotoUrls.length > 0) {
      const updatedPhotos = [...shift.startPhotoUrls];
      let changed = false;
      for (let i = 0; i < updatedPhotos.length; i++) {
        if (updatedPhotos[i].startsWith("data:image/")) {
          try {
            updatedPhotos[i] = await uploadBase64Field(updatedPhotos[i], "vehicle-photos");
            changed = true;
          } catch (e: any) {
            console.error(e.message);
          }
        }
      }
      if (changed) updateFields.startPhotoUrls = updatedPhotos;
    }

    if (shift.endPhotoUrls && shift.endPhotoUrls.length > 0) {
      const updatedPhotos = [...shift.endPhotoUrls];
      let changed = false;
      for (let i = 0; i < updatedPhotos.length; i++) {
        if (updatedPhotos[i].startsWith("data:image/")) {
          try {
            updatedPhotos[i] = await uploadBase64Field(updatedPhotos[i], "vehicle-photos");
            changed = true;
          } catch (e: any) {
            console.error(e.message);
          }
        }
      }
      if (changed) updateFields.endPhotoUrls = updatedPhotos;
    }

    if (Object.keys(updateFields).length > 0) {
      await DriverShift.updateOne({ _id: shift._id }, { $set: updateFields });
      totalMigrated++;
      console.log(`✓ Migrated DriverShift ${shift._id}`);
    }
  }

  // 4. Final verification
  console.log("\n========================================");
  console.log("FINAL AUDIT VERIFICATION");
  console.log("========================================");
  const remainingTrips = await Trip.countDocuments({
    $or: [
      { signature: { $regex: base64Regex } },
      { receiverSignature: { $regex: base64Regex } },
      { passengerAvatarUrl: { $regex: base64Regex } },
    ],
  });
  const remainingUsers = await User.countDocuments({ avatarUrl: { $regex: base64Regex } });
  const remainingShifts = await DriverShift.countDocuments({
    $or: [
      { startPhotoUrl: { $regex: base64Regex } },
      { endPhotoUrl: { $regex: base64Regex } },
      { startPhotoUrls: { $regex: base64Regex } },
      { endPhotoUrls: { $regex: base64Regex } },
    ],
  });

  console.log(`Remaining Trips with base64: ${remainingTrips}`);
  console.log(`Remaining Users with base64: ${remainingUsers}`);
  console.log(`Remaining Shifts with base64: ${remainingShifts}`);
  console.log(`Unique S3 Files Uploaded: ${uploadCache.size}`);
  console.log(`Total Documents Updated: ${totalMigrated}`);

  if (remainingTrips === 0 && remainingUsers === 0 && remainingShifts === 0) {
    console.log(">>> SUCCESS: ZERO BASE64 IMAGES REMAIN IN MONGODB! <<<");
  } else {
    console.warn(">>> WARNING: Some base64 fields could not be migrated. Check errors above. <<<");
  }

  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
