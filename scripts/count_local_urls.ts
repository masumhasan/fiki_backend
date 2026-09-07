import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const db = mongoose.connection.db;
  if (!db) throw new Error("No database");

  console.log("=== CHECKING ALL MEDIA URLS ACROSS MONGODB ===");

  // 1. DriverShift
  const shifts = await db.collection("drivershifts").find({}).toArray();
  let shiftIssues = 0;
  for (const s of shifts) {
    const urls = [s.startPhotoUrl, s.endPhotoUrl, ...(s.startPhotoUrls || []), ...(s.endPhotoUrls || [])].filter(Boolean);
    for (const u of urls) {
      if (typeof u === "string" && !u.includes(".amazonaws.com/")) {
        console.log(`[DriverShift ${s._id}] Non-S3 URL:`, u.substring(0, 100));
        shiftIssues++;
      }
    }
  }
  console.log(`DriverShifts checked: ${shifts.length}, Non-S3 issues: ${shiftIssues}`);

  // 2. Users
  const users = await db.collection("users").find({ avatarUrl: { $exists: true, $ne: "" } }).toArray();
  let userIssues = 0;
  for (const u of users) {
    if (typeof u.avatarUrl === "string" && !u.avatarUrl.includes(".amazonaws.com/")) {
      console.log(`[User ${u._id}] Non-S3 Avatar:`, u.avatarUrl.substring(0, 100));
      userIssues++;
    }
  }
  console.log(`Users checked: ${users.length}, Non-S3 issues: ${userIssues}`);

  // 3. DriverProfile
  const profiles = await db.collection("driverprofiles").find({ avatarUrl: { $exists: true, $ne: "" } }).toArray();
  let profileIssues = 0;
  for (const p of profiles) {
    if (typeof p.avatarUrl === "string" && !p.avatarUrl.includes(".amazonaws.com/")) {
      console.log(`[DriverProfile ${p._id}] Non-S3 Avatar:`, p.avatarUrl.substring(0, 100));
      profileIssues++;
    }
  }
  console.log(`DriverProfiles checked: ${profiles.length}, Non-S3 issues: ${profileIssues}`);

  // 4. Trips
  const trips = await db.collection("trips").find({
    $or: [
      { passengerAvatarUrl: { $exists: true, $ne: "" } },
      { signature: { $exists: true, $ne: "" } },
      { receiverSignature: { $exists: true, $ne: "" } },
    ]
  }).toArray();
  let tripIssues = 0;
  for (const t of trips) {
    const fields = [
      { name: "passengerAvatarUrl", val: t.passengerAvatarUrl },
      { name: "signature", val: t.signature },
      { name: "receiverSignature", val: t.receiverSignature }
    ];
    for (const f of fields) {
      if (f.val && typeof f.val === "string" && !f.val.includes(".amazonaws.com/")) {
        console.log(`[Trip ${t._id}] ${f.name} Non-S3:`, f.val.substring(0, 100));
        tripIssues++;
      }
    }
  }
  console.log(`Trips with images/signatures checked: ${trips.length}, Non-S3 issues: ${tripIssues}`);

  // 5. DriverApplications
  const apps = await db.collection("driverapplications").find({
    $or: [
      { signature: { $exists: true, $ne: "" } },
      { bidForm: { $exists: true, $ne: "" } }
    ]
  }).toArray();
  let appIssues = 0;
  for (const a of apps) {
    const fields = [
      { name: "signature", val: a.signature },
      { name: "bidForm", val: a.bidForm }
    ];
    for (const f of fields) {
      if (f.val && typeof f.val === "string" && !f.val.includes(".amazonaws.com/")) {
        console.log(`[DriverApp ${a._id}] ${f.name} Non-S3:`, f.val.substring(0, 100));
        appIssues++;
      }
    }
  }
  console.log(`DriverApplications checked: ${apps.length}, Non-S3 issues: ${appIssues}`);

  console.log("=== SUMMARY ===");
  console.log(`Total non-S3 issues: ${shiftIssues + userIssues + profileIssues + tripIssues + appIssues}`);

  await mongoose.disconnect();
}

run().catch(console.error);
