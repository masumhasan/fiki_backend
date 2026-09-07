import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { uploadImageToS3 } from "../src/services/s3Service.js";
import { User } from "../src/models/User.js";
import { DriverShift } from "../src/models/DriverShift.js";
import { Trip } from "../src/models/Trip.js";

dotenv.config({ path: path.join(process.cwd(), ".env") });

async function migrateLocalUploads() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("Connected to MongoDB.");

  const uploadsDir = path.join(process.cwd(), "uploads");

  // Helper to upload a local file to S3 or convert URL
  async function resolveLocalUrl(url: string, category: string): Promise<string> {
    if (!url || (!url.includes("localhost:5000") && !url.includes("127.0.0.1:5000"))) {
      return url;
    }

    // Extract relative path after /uploads/
    const match = url.match(/\/uploads\/(.+)$/);
    if (!match) return url;

    const relativePath = match[1];
    const localFilePath = path.join(uploadsDir, relativePath);

    if (fs.existsSync(localFilePath)) {
      console.log(`Found file on disk: ${localFilePath}, uploading to S3...`);
      const fileBuffer = fs.readFileSync(localFilePath);
      const ext = path.extname(localFilePath).replace(".", "") || "jpeg";
      const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      const s3Url = await uploadImageToS3(fileBuffer, path.basename(localFilePath), mimeType, category);
      console.log(`✓ Uploaded to S3: ${s3Url}`);
      return s3Url;
    } else {
      // File not on current machine's disk (e.g. running locally while file is on EC2)
      // Point to production backend API domain where EC2 serves /uploads statically
      const prodUrl = `https://api.fikitransit.com/uploads/${relativePath}`;
      console.log(`File not on current disk (${relativePath}). Converting to public URL: ${prodUrl}`);
      return prodUrl;
    }
  }

  // 1. Migrate Users
  const users = await User.find({
    avatarUrl: { $regex: /127\.0\.0\.1:5000|localhost:5000/ },
  });
  console.log(`Found ${users.length} users with localhost/127.0.0.1 avatarUrl.`);
  for (const user of users) {
    if (user.avatarUrl) {
      const newUrl = await resolveLocalUrl(user.avatarUrl, "avatars");
      await User.updateOne({ _id: user._id }, { $set: { avatarUrl: newUrl } });
      console.log(`Updated user ${user.name} (${user._id}) -> ${newUrl}`);
    }
  }

  // 2. Migrate DriverShifts
  const shifts = await DriverShift.find({
    $or: [
      { startPhotoUrl: { $regex: /127\.0\.0\.1:5000|localhost:5000/ } },
      { endPhotoUrl: { $regex: /127\.0\.0\.1:5000|localhost:5000/ } },
      { startPhotoUrls: { $regex: /127\.0\.0\.1:5000|localhost:5000/ } },
      { endPhotoUrls: { $regex: /127\.0\.0\.1:5000|localhost:5000/ } },
    ],
  });
  console.log(`Found ${shifts.length} DriverShifts with localhost/127.0.0.1 URLs.`);
  for (const shift of shifts) {
    const update: any = {};
    if (shift.startPhotoUrl) {
      update.startPhotoUrl = await resolveLocalUrl(shift.startPhotoUrl, "shift-odometers");
    }
    if (shift.endPhotoUrl) {
      update.endPhotoUrl = await resolveLocalUrl(shift.endPhotoUrl, "shift-odometers");
    }
    if (shift.startPhotoUrls && shift.startPhotoUrls.length > 0) {
      update.startPhotoUrls = await Promise.all(
        shift.startPhotoUrls.map((u: string) => resolveLocalUrl(u, "shift-odometers"))
      );
    }
    if (shift.endPhotoUrls && shift.endPhotoUrls.length > 0) {
      update.endPhotoUrls = await Promise.all(
        shift.endPhotoUrls.map((u: string) => resolveLocalUrl(u, "shift-odometers"))
      );
    }
    await DriverShift.updateOne({ _id: shift._id }, { $set: update });
    console.log(`✓ Updated DriverShift ${shift._id}`);
  }

  // 3. Migrate Trips
  const trips = await Trip.find({
    passengerAvatarUrl: { $regex: /127\.0\.0\.1:5000|localhost:5000/ },
  });
  console.log(`Found ${trips.length} trips with localhost/127.0.0.1 passengerAvatarUrl.`);
  for (const trip of trips) {
    if (trip.passengerAvatarUrl) {
      const newUrl = await resolveLocalUrl(trip.passengerAvatarUrl, "passenger-avatars");
      await Trip.updateOne({ _id: trip._id }, { $set: { passengerAvatarUrl: newUrl } });
      console.log(`✓ Updated Trip ${trip._id}`);
    }
  }

  console.log("\nMigration completed successfully.");
  await mongoose.disconnect();
}

migrateLocalUploads().catch(console.error);
