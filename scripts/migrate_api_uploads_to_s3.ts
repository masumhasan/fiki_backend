import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { uploadImageToS3 } from "../src/services/s3Service.js";
import { User } from "../src/models/User.js";
import { DriverShift } from "../src/models/DriverShift.js";
import { Trip } from "../src/models/Trip.js";

dotenv.config({ path: path.join(process.cwd(), ".env") });

async function migrateAllToS3() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("Connected to MongoDB.");

  async function convertToS3(url: string, category: string): Promise<string> {
    if (!url || typeof url !== "string") return url;
    // Only convert URLs that are local or hosted on api.fikitransit.com/uploads/
    if (!url.includes("/uploads/")) return url;
    if (url.includes(".amazonaws.com/")) return url; // already S3

    try {
      console.log(`Downloading: ${url}...`);
      const fullUrl = url.startsWith("http") ? url : `https://api.fikitransit.com${url.startsWith("/") ? "" : "/"}${url}`;
      const res = await fetch(fullUrl);
      if (!res.ok) {
        console.error(`Failed to fetch ${fullUrl}: status ${res.status}`);
        return url;
      }
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const filename = path.basename(new URL(fullUrl).pathname) || "photo.jpg";
      const ext = path.extname(filename).replace(".", "") || "jpg";
      const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

      const s3Url = await uploadImageToS3(buffer, filename, mimeType, category);
      console.log(`✓ S3 Uploaded: ${s3Url}`);
      return s3Url;
    } catch (err: any) {
      console.error(`Error converting ${url} to S3:`, err.message);
      return url;
    }
  }

  // 1. Users (avatarUrl)
  const users = await User.find({ avatarUrl: { $regex: /\/uploads\// } });
  console.log(`Found ${users.length} users with /uploads/ URLs.`);
  for (const user of users) {
    if (user.avatarUrl && !user.avatarUrl.includes(".amazonaws.com")) {
      const s3Url = await convertToS3(user.avatarUrl, "avatars");
      if (s3Url && s3Url.includes(".amazonaws.com")) {
        await User.updateOne({ _id: user._id }, { $set: { avatarUrl: s3Url } });
        console.log(`Updated user ${user.name} (${user._id}) to S3.`);
      }
    }
  }

  // 2. DriverShifts (startPhotoUrl, endPhotoUrl, startPhotoUrls, endPhotoUrls)
  const shifts = await DriverShift.find({
    $or: [
      { startPhotoUrl: { $regex: /\/uploads\// } },
      { endPhotoUrl: { $regex: /\/uploads\// } },
      { startPhotoUrls: { $regex: /\/uploads\// } },
      { endPhotoUrls: { $regex: /\/uploads\// } },
    ],
  });
  console.log(`Found ${shifts.length} DriverShifts with /uploads/ URLs.`);
  for (const shift of shifts) {
    const update: any = {};
    if (shift.startPhotoUrl && !shift.startPhotoUrl.includes(".amazonaws.com")) {
      update.startPhotoUrl = await convertToS3(shift.startPhotoUrl, "shift-odometers");
    }
    if (shift.endPhotoUrl && !shift.endPhotoUrl.includes(".amazonaws.com")) {
      update.endPhotoUrl = await convertToS3(shift.endPhotoUrl, "shift-odometers");
    }
    if (shift.startPhotoUrls && shift.startPhotoUrls.length > 0) {
      update.startPhotoUrls = await Promise.all(
        shift.startPhotoUrls.map(async (u: string) => {
          if (u.includes(".amazonaws.com")) return u;
          return await convertToS3(u, "shift-odometers");
        })
      );
    }
    if (shift.endPhotoUrls && shift.endPhotoUrls.length > 0) {
      update.endPhotoUrls = await Promise.all(
        shift.endPhotoUrls.map(async (u: string) => {
          if (u.includes(".amazonaws.com")) return u;
          return await convertToS3(u, "shift-odometers");
        })
      );
    }

    if (Object.keys(update).length > 0) {
      await DriverShift.updateOne({ _id: shift._id }, { $set: update });
      console.log(`✓ Updated DriverShift ${shift._id} to S3.`);
    }
  }

  // 3. Trips (passengerAvatarUrl, signature, receiverSignature)
  const trips = await Trip.find({
    $or: [
      { passengerAvatarUrl: { $regex: /\/uploads\// } },
      { signature: { $regex: /\/uploads\// } },
      { receiverSignature: { $regex: /\/uploads\// } },
    ],
  });
  console.log(`Found ${trips.length} Trips with /uploads/ URLs.`);
  for (const trip of trips) {
    const update: any = {};
    if (trip.passengerAvatarUrl && !trip.passengerAvatarUrl.includes(".amazonaws.com")) {
      update.passengerAvatarUrl = await convertToS3(trip.passengerAvatarUrl, "passenger-avatars");
    }
    if (trip.signature && !trip.signature.includes(".amazonaws.com")) {
      update.signature = await convertToS3(trip.signature, "signatures");
    }
    if (trip.receiverSignature && !trip.receiverSignature.includes(".amazonaws.com")) {
      update.receiverSignature = await convertToS3(trip.receiverSignature, "signatures");
    }
    if (Object.keys(update).length > 0) {
      await Trip.updateOne({ _id: trip._id }, { $set: update });
      console.log(`✓ Updated Trip ${trip._id} to S3.`);
    }
  }

  console.log("\n--- Audit Verification ---");
  const remainingShifts = await DriverShift.countDocuments({
    $or: [
      { startPhotoUrl: { $regex: /fikitransit\.com\/uploads/ } },
      { endPhotoUrl: { $regex: /fikitransit\.com\/uploads/ } },
      { startPhotoUrls: { $regex: /fikitransit\.com\/uploads/ } },
      { endPhotoUrls: { $regex: /fikitransit\.com\/uploads/ } },
    ],
  });
  const remainingUsers = await User.countDocuments({ avatarUrl: { $regex: /fikitransit\.com\/uploads/ } });
  console.log(`Remaining non-S3 shifts: ${remainingShifts}`);
  console.log(`Remaining non-S3 users: ${remainingUsers}`);

  await mongoose.disconnect();
}

migrateAllToS3().catch(console.error);
