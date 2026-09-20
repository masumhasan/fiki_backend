import mongoose from "mongoose";
import { DriverProfile } from "../../models/DriverProfile.js";
import { User } from "../../models/User.js";
import { Vehicle } from "../../models/Vehicle.js";
import { DriverApplication } from "../../models/DriverApplication.js";

export async function syncDriverProfileWithApplication(user: any, profileDoc?: any) {
  let profile = profileDoc || (await DriverProfile.findOne({ userId: user._id }));
  if (!profile) {
    profile = new DriverProfile({
      userId: user._id,
      approvalStatus: "APPROVED",
      availabilityStatus: "OFFLINE",
    });
  }

  if (!profile.licenseNumber || !profile.licenseExpirationDate) {
    const userEmail = (user.email || "").toLowerCase().trim();
    const userName = (user.name || "").trim();

    const app = await DriverApplication.findOne({
      $or: [
        userEmail ? { email: new RegExp(`^${userEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } : undefined,
        userName ? { fullName: new RegExp(`^${userName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } : undefined,
      ].filter(Boolean) as any,
    });

    let modified = false;
    if (app) {
      if (!profile.licenseNumber && app.licenseNumber) {
        profile.licenseNumber = app.licenseNumber;
        modified = true;
      }
      if (!profile.licenseExpirationDate && app.licenseExpirationDate) {
        profile.licenseExpirationDate = app.licenseExpirationDate;
        modified = true;
      }
    }

    if (profile.isNew || modified) {
      await profile.save();
    }
  }

  // Ensure vehicle is synced if missing on profile but assigned in Vehicle collection
  if (!profile.vehicle?.licensePlate || !profile.vehicleId) {
    const assignedVehicle = await Vehicle.findOne({ assignedDriverId: user._id });
    if (assignedVehicle) {
      profile.vehicle = {
        model: assignedVehicle.modelName,
        year: assignedVehicle.year,
        licensePlate: assignedVehicle.licensePlate,
      };
      profile.vehicleId = assignedVehicle._id as any;
      await profile.save();
    } else if (profile.vehicleId && !profile.vehicle?.licensePlate) {
      const v = await Vehicle.findById(profile.vehicleId);
      if (v) {
        profile.vehicle = {
          model: v.modelName,
          year: v.year,
          licensePlate: v.licensePlate,
        };
        await profile.save();
      }
    }
  }

  return profile;
}

export async function resolveDriverProfile(id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const objId = new mongoose.Types.ObjectId(id);

  let profile = await DriverProfile.findOne({
    $or: [{ _id: objId }, { userId: objId }],
  });

  if (profile) {
    const user = await User.findById(profile.userId);
    if (user) {
      profile = await syncDriverProfileWithApplication(user, profile);
    }
    return profile;
  }

  const app: any = await DriverApplication.findById(objId).catch(() => null);
  if (app) {
    if (app.userId) {
      profile = await DriverProfile.findOne({ userId: app.userId });
      if (profile) return profile;
    }
    if (app.driverProfileId) {
      profile = await DriverProfile.findById(app.driverProfileId);
      if (profile) return profile;
    }
  }

  const user = await User.findById(objId);
  if (user) {
    profile = await syncDriverProfileWithApplication(user);
    return profile;
  }

  return null;
}
