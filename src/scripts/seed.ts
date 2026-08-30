import bcrypt from "bcryptjs";
import { connectDB, disconnectDB } from "../config/db.js";
import { DriverProfile } from "../models/DriverProfile.js";
import { User, UserRole } from "../models/User.js";

const DEFAULT_ACCOUNTS = [
  {
    email: "mail.sparktechai@gmail.com",
    password: "Test@123",
    role: "ADMIN" as UserRole,
    name: "System Admin",
    phone: "+18003454825",
  },
  {
    email: "driver@fikitransit.com",
    password: "Test@123",
    role: "DRIVER" as UserRole,
    name: "John Rivera",
    phone: "+18003454826",
    vehicle: {
      make: "Toyota",
      model: "Sienna",
      year: 2023,
      color: "White",
      licensePlate: "MIA-4821",
    },
  },
  {
    email: "user@fikitransit.com",
    password: "Test@123",
    role: "USER" as UserRole,
    name: "Test Rider",
    phone: "+18003454827",
  },
];

async function seed() {
  console.log("🌱 Starting Database Seed...");
  await connectDB();

  const passwordHash = await bcrypt.hash("Test@123", 12);

  for (const account of DEFAULT_ACCOUNTS) {
    let user = await User.findOne({ email: account.email });

    if (!user) {
      user = await User.create({
        email: account.email,
        passwordHash,
        role: account.role,
        name: account.name,
        phone: account.phone,
        accountStatus: "ACTIVE",
      });
      console.log(`✅ Created ${account.role} account: ${account.email}`);
    } else {
      user.passwordHash = passwordHash;
      user.accountStatus = "ACTIVE";
      user.name = account.name;
      user.role = account.role;
      await user.save();
      console.log(`🔄 Updated ${account.role} account: ${account.email}`);
    }

    if (account.role === "DRIVER") {
      let driverProfile = await DriverProfile.findOne({ userId: user._id });
      if (!driverProfile) {
        await DriverProfile.create({
          userId: user._id,
          licenseNumber: "DL-987654321",
          licenseExpirationDate: "2028-08-24",
          vehicle: account.vehicle,
          approvalStatus: "APPROVED",
          availabilityStatus: "OFFLINE",
          currentLocation: {
            type: "Point",
            coordinates: [-80.1918, 25.7617],
            updatedAt: new Date(),
          },
        });
        console.log(`✅ Created DriverProfile for ${account.email}`);
      }
    }
  }

  console.log("\n🎉 Seeding Completed Successfully!");
  await disconnectDB();
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
