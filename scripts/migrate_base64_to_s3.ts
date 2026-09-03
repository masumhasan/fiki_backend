import mongoose from "mongoose";
import dotenv from "dotenv";
import { User } from "../src/models/User.js";
import { Trip } from "../src/models/Trip.js";
import { DriverShift } from "../src/models/DriverShift.js";

import { fileURLToPath } from 'url';
import path from 'path';

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

async function uploadBase64Field(base64: string, category: string): Promise<string> {
  const mimeType = getMimeType(base64);
  const buffer = base64ToBuffer(base64);
  const ext = mimeType.split("/")[1] || "jpg";
  const fileName = `migration_${Date.now()}.${ext}`;
  const { uploadImageToS3 } = await import("../src/services/s3Service.js");
  return await uploadImageToS3(buffer, fileName, mimeType, category);
}

async function migrate() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGO_URI);
  console.log("Connected to DB.");

  let totalMigrated = 0;

  // 1. Migrate Users (avatarUrl)
  console.log("--- Scanning Users ---");
  const users = await User.find({ avatarUrl: { $regex: /^data:image\// } });
  console.log(`Found ${users.length} users with base64 avatarUrl.`);
  for (const user of users) {
    if (user.avatarUrl && user.avatarUrl.startsWith("data:image/")) {
      console.log(`Uploading avatar for user ${user._id}...`);
      try {
        const url = await uploadBase64Field(user.avatarUrl, "passenger-avatars");
        user.avatarUrl = url;
        await user.save();
        totalMigrated++;
      } catch (e: any) {
        console.error(`Failed to upload avatar for user ${user._id}: ${e.message}`);
      }
    }
  }

  // 2. Migrate Trips (signature, receiverSignature, passengerAvatarUrl)
  console.log("--- Scanning Trips ---");
  const trips = await Trip.find({
    $or: [
      { signature: { $regex: /^data:image\// } },
      { receiverSignature: { $regex: /^data:image\// } },
      { passengerAvatarUrl: { $regex: /^data:image\// } },
    ]
  });
  console.log(`Found ${trips.length} trips with base64 fields.`);
  for (const trip of trips) {
    let updated = false;
    
    if (trip.signature && trip.signature.startsWith("data:image/")) {
      console.log(`Uploading signature for trip ${trip._id}...`);
      try {
        trip.signature = await uploadBase64Field(trip.signature, "signatures");
        updated = true;
      } catch (e: any) { console.error(e.message); }
    }
    
    if (trip.receiverSignature && trip.receiverSignature.startsWith("data:image/")) {
      console.log(`Uploading receiverSignature for trip ${trip._id}...`);
      try {
        trip.receiverSignature = await uploadBase64Field(trip.receiverSignature, "signatures");
        updated = true;
      } catch (e: any) { console.error(e.message); }
    }

    if (trip.passengerAvatarUrl && trip.passengerAvatarUrl.startsWith("data:image/")) {
      console.log(`Uploading passengerAvatarUrl for trip ${trip._id}...`);
      try {
        trip.passengerAvatarUrl = await uploadBase64Field(trip.passengerAvatarUrl, "passenger-avatars");
        updated = true;
      } catch (e: any) { console.error(e.message); }
    }

    if (updated) {
      await trip.save();
      totalMigrated++;
    }
  }

  // 3. Migrate DriverShifts (startPhotoUrl, endPhotoUrl, startPhotoUrls, endPhotoUrls)
  console.log("--- Scanning DriverShifts ---");
  const shifts = await DriverShift.find({
    $or: [
      { startPhotoUrl: { $regex: /^data:image\// } },
      { endPhotoUrl: { $regex: /^data:image\// } },
      { startPhotoUrls: { $regex: /^data:image\// } },
      { endPhotoUrls: { $regex: /^data:image\// } },
    ]
  });
  console.log(`Found ${shifts.length} DriverShifts with base64 fields.`);
  for (const shift of shifts) {
    let updated = false;

    if (shift.startPhotoUrl && shift.startPhotoUrl.startsWith("data:image/")) {
      console.log(`Uploading startPhotoUrl for shift ${shift._id}...`);
      try {
        shift.startPhotoUrl = await uploadBase64Field(shift.startPhotoUrl, "shift-odometers");
        updated = true;
      } catch (e: any) { console.error(e.message); }
    }

    if (shift.endPhotoUrl && shift.endPhotoUrl.startsWith("data:image/")) {
      console.log(`Uploading endPhotoUrl for shift ${shift._id}...`);
      try {
        shift.endPhotoUrl = await uploadBase64Field(shift.endPhotoUrl, "shift-odometers");
        updated = true;
      } catch (e: any) { console.error(e.message); }
    }
    
    if (shift.startPhotoUrls && shift.startPhotoUrls.length > 0) {
      for (let i = 0; i < shift.startPhotoUrls.length; i++) {
        if (shift.startPhotoUrls[i].startsWith("data:image/")) {
          try {
            shift.startPhotoUrls[i] = await uploadBase64Field(shift.startPhotoUrls[i], "vehicle-photos");
            updated = true;
          } catch (e: any) { console.error(e.message); }
        }
      }
    }
    
    if (shift.endPhotoUrls && shift.endPhotoUrls.length > 0) {
      for (let i = 0; i < shift.endPhotoUrls.length; i++) {
        if (shift.endPhotoUrls[i].startsWith("data:image/")) {
          try {
            shift.endPhotoUrls[i] = await uploadBase64Field(shift.endPhotoUrls[i], "vehicle-photos");
            updated = true;
          } catch (e: any) { console.error(e.message); }
        }
      }
    }

    if (updated) {
      await shift.save();
      totalMigrated++;
    }
  }

  console.log(`\nMigration completed! Updated ${totalMigrated} documents in total.`);
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
