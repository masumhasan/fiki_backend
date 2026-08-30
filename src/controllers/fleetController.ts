import { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { VehicleReport } from "../models/VehicleReport.js";
import { DriverApplication } from "../models/DriverApplication.js";
import { User } from "../models/User.js";
import { DriverProfile } from "../models/DriverProfile.js";
import { Vehicle } from "../models/Vehicle.js";
import { DriverShift } from "../models/DriverShift.js";

const vehicleReportSchema = z.object({
  vehicleId: z.string().min(1, "Vehicle ID is required"),
  make: z.string().min(1, "Make is required"),
  vehicleModel: z.string().min(1, "Model is required"),
  licensePlate: z.string().min(1, "License plate is required"),
  inspectionStatus: z.enum(["PASS", "FAIL", "MAINTENANCE_REQUIRED"]).default("PASS"),
  fuelLevelPercentage: z.number().min(0).max(100),
  wheelchairLiftOperational: z.boolean().default(true),
  notes: z.string().optional(),
  inspectorName: z.string().min(1, "Inspector name is required"),
});

export class FleetController {
  async getShiftReports(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const shifts = await DriverShift.find()
        .populate("driverId", "name email phone")
        .sort({ startedAt: -1, createdAt: -1 })
        .lean();

      const driverUserIds = shifts.map((s: any) => s.driverId?._id || s.driverId).filter(Boolean);
      const profiles = await DriverProfile.find({ userId: { $in: driverUserIds } }).lean();
      const profileMap = new Map();
      profiles.forEach((p: any) => profileMap.set(p.userId.toString(), p));

      const reports = shifts.map((s: any) => {
        const driverUser = s.driverId;
        const driverIdStr = driverUser?._id?.toString() || s.driverId?.toString();
        const profile = profileMap.get(driverIdStr);

        const driverName = driverUser?.name || "Driver";
        const vehicleName = [s.vehicleInfo?.make || profile?.vehicle?.make || "Toyota", s.vehicleInfo?.model || profile?.vehicle?.model || "Sienna"].filter(Boolean).join(" ");
        const vehicleNumber = s.vehicleInfo?.licensePlate || profile?.vehicle?.licensePlate || "FKT-1234";

        const startDateObj = new Date(s.startedAt);
        const dateStr = startDateObj.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

        const startTimeStr = startDateObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const endTimeStr = s.endedAt ? new Date(s.endedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
        const shiftTimeText = s.status === "COMPLETED" ? `${startTimeStr} – ${endTimeStr}` : `Started at ${startTimeStr}`;

        return {
          id: s._id.toString(),
          shiftId: `VR-S-${s._id.toString().substring(s._id.toString().length - 4).toUpperCase()}`,
          driverName,
          driverEmail: driverUser?.email || "—",
          driverPhone: driverUser?.phone || "—",
          driverCode: profile?.licenseNumber ? `D-${profile.licenseNumber.substring(0, 4)}` : `D-${s._id.toString().substring(0, 4).toUpperCase()}`,
          vehicleName,
          vehicleNumber,
          shiftTimeText,
          shiftDateText: dateStr,
          status: s.status === "COMPLETED" ? "Completed" : "In progress",
          startingOdometer: s.startingOdometer,
          endingOdometer: s.endingOdometer || null,
          estimatedMiles: s.estimatedMiles || (s.endingOdometer ? s.endingOdometer - s.startingOdometer : 0),
          startFuel: s.startFuel || "half",
          endFuel: s.endFuel || "half",
          startCondition: s.startCondition || "clear",
          endCondition: s.endCondition || "clear",
          startNotes: s.startNotes || "",
          endNotes: s.endNotes || "",
          startPhotoUrl: s.startPhotoUrl || "",
          endPhotoUrl: s.endPhotoUrl || "",
          totalHoursText: s.totalHoursText || (s.endedAt ? `${Math.round((new Date(s.endedAt).getTime() - startDateObj.getTime()) / 3600000)}h` : "In progress"),
          startedAt: s.startedAt,
          endedAt: s.endedAt,
        };
      });

      res.status(200).json({
        success: true,
        data: reports,
      });
    } catch (error) {
      next(error);
    }
  }

  async getShiftReportById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawId = req.params.id;
      const id = Array.isArray(rawId) ? rawId[0] : rawId;

      let shift: any = null;
      if (mongoose.Types.ObjectId.isValid(id)) {
        shift = await DriverShift.findById(id).populate("driverId", "name email phone").lean();
      }
      if (!shift) {
        const allShifts = await DriverShift.find().populate("driverId", "name email phone").sort({ startedAt: -1 }).lean();
        shift = allShifts.find((s: any) => s._id.toString().endsWith(id.replace("VR-S-", "").toLowerCase()) || s._id.toString() === id);
      }

      if (!shift) {
        res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Shift report not found" },
        });
        return;
      }

      const driverUser = shift.driverId;
      const driverIdStr = driverUser?._id?.toString() || shift.driverId?.toString();
      const profile = await DriverProfile.findOne({ userId: driverIdStr }).lean();

      const driverName = driverUser?.name || "Driver";
      const vehicleName = [shift.vehicleInfo?.make || profile?.vehicle?.make || "Toyota", shift.vehicleInfo?.model || profile?.vehicle?.model || "Sienna"].filter(Boolean).join(" ");
      const vehicleNumber = shift.vehicleInfo?.licensePlate || profile?.vehicle?.licensePlate || "FKT-1234";

      const startDateObj = new Date(shift.startedAt);
      const dateStr = startDateObj.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

      const startTimeStr = startDateObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const endTimeStr = shift.endedAt ? new Date(shift.endedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
      const shiftTimeText = shift.status === "COMPLETED" ? `${startTimeStr} – ${endTimeStr}` : `Started at ${startTimeStr}`;

      res.status(200).json({
        success: true,
        data: {
          id: shift._id.toString(),
          shiftId: `VR-S-${shift._id.toString().substring(shift._id.toString().length - 4).toUpperCase()}`,
          driverName,
          driverEmail: driverUser?.email || "—",
          driverPhone: driverUser?.phone || "—",
          driverCode: profile?.licenseNumber ? `D-${profile.licenseNumber.substring(0, 4)}` : `D-${shift._id.toString().substring(0, 4).toUpperCase()}`,
          vehicleName,
          vehicleNumber,
          shiftTimeText,
          startTimeStr,
          endTimeStr,
          shiftDateText: dateStr,
          status: shift.status === "COMPLETED" ? "Completed" : "In progress",
          startingOdometer: shift.startingOdometer,
          endingOdometer: shift.endingOdometer || null,
          estimatedMiles: shift.estimatedMiles || (shift.endingOdometer ? shift.endingOdometer - shift.startingOdometer : 0),
          startFuel: shift.startFuel || "half",
          endFuel: shift.endFuel || "half",
          startCondition: shift.startCondition || "clear",
          endCondition: shift.endCondition || "clear",
          startNotes: shift.startNotes || "",
          endNotes: shift.endNotes || "",
          startPhotoUrl: shift.startPhotoUrl || "",
          endPhotoUrl: shift.endPhotoUrl || "",
          totalHoursText: shift.totalHoursText || (shift.endedAt ? `${Math.round((new Date(shift.endedAt).getTime() - startDateObj.getTime()) / 3600000)}h` : "In progress"),
          startedAt: shift.startedAt,
          endedAt: shift.endedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async getVehicleReports(req: Request, res: Response, next: NextFunction): Promise<void> {
    return this.getShiftReports(req, res, next);
  }

  async createVehicleReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = vehicleReportSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({
          success: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid vehicle report payload",
            details: parsed.error.flatten().fieldErrors,
          },
        });
        return;
      }

      const report = await VehicleReport.create(parsed.data);

      res.status(201).json({
        success: true,
        data: report,
      });
    } catch (error) {
      next(error);
    }
  }

  async getDriverApplications(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      let apps = await DriverApplication.find().sort({ createdAt: -1 });

      // Seed initial sample applications if empty
      if (apps.length === 0) {
        const initialApps = [
          {
            applicationId: "APP-2026-001",
            fullName: "Marcus Johnson",
            email: "marcus.johnson@gmail.com",
            phone: "(305) 847-2291",
            licenseNumber: "CDL-A F3847291",
            licenseExpirationDate: "2029-08-15",
            positionType: "AMBULATORY",
            backgroundStatus: "CLEARED",
            status: "PENDING_REVIEW",
          },
          {
            applicationId: "APP-2026-002",
            fullName: "Robert Okafor",
            email: "r.okafor@gmail.com",
            phone: "(954) 772-3349",
            licenseNumber: "CDL-A R8812738",
            licenseExpirationDate: "2028-11-20",
            positionType: "WHEELCHAIR",
            backgroundStatus: "CLEARED",
            status: "INTERVIEW_SCHEDULED",
          },
        ];
        apps = await DriverApplication.insertMany(initialApps) as any;
      }

      res.status(200).json({
        success: true,
        data: apps,
      });
    } catch (error) {
      next(error);
    }
  }

  async getDriverApplicationById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawId = req.params.id;
      const id = Array.isArray(rawId) ? rawId[0] : rawId;

      let app = null;
      if (mongoose.Types.ObjectId.isValid(id)) {
        app = await DriverApplication.findById(id);
      }
      if (!app) {
        app = await DriverApplication.findOne({ applicationId: id });
      }

      if (!app) {
        res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Driver application not found" },
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: app,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateDriverApplicationStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!status || !["PENDING_REVIEW", "INTERVIEW_SCHEDULED", "APPROVED", "REJECTED"].includes(status)) {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_STATUS", message: "Invalid application status specified" },
        });
        return;
      }

      const app = await DriverApplication.findByIdAndUpdate(
        id,
        { status },
        { new: true }
      );

      if (!app) {
        res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Driver application not found" },
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: app,
      });
    } catch (error) {
      next(error);
    }
  }

  async approveDriverApplication(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawId = req.params.id;
      const id = Array.isArray(rawId) ? rawId[0] : rawId;
      const { vehicleId } = req.body;

      let app = null;
      if (mongoose.Types.ObjectId.isValid(id)) {
        app = await DriverApplication.findById(id);
      }
      if (!app) {
        app = await DriverApplication.findOne({ applicationId: id });
      }

      if (!app) {
        res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Driver application not found" },
        });
        return;
      }

      let selectedVehicle = null;
      if (vehicleId) {
        selectedVehicle = await Vehicle.findById(vehicleId);
      }

      // Update application status
      app.status = "APPROVED";
      if (selectedVehicle) {
        app.assignedVehicleId = selectedVehicle._id as any;
      }
      await app.save();

      // Find or create User with role DRIVER
      let driverUser = await User.findOne({ email: app.email.toLowerCase() });
      if (!driverUser) {
        driverUser = await User.create({
          email: app.email.toLowerCase(),
          passwordHash: "$2a$12$eImiTXuWVxfM37uY4JANjO5E/8051Ew.", // default Test@123
          role: "DRIVER",
          name: app.fullName,
          phone: app.phone,
          accountStatus: "ACTIVE",
        });
      }

      // Find or create DriverProfile
      let profile = await DriverProfile.findOne({ userId: driverUser._id });
      if (!profile) {
        profile = new DriverProfile({
          userId: driverUser._id,
          licenseNumber: app.licenseNumber,
          licenseExpirationDate: app.licenseExpirationDate,
          approvalStatus: "APPROVED",
          availabilityStatus: "ONLINE",
        });
      } else {
        if (!profile.licenseNumber) profile.licenseNumber = app.licenseNumber;
        if (!profile.licenseExpirationDate) profile.licenseExpirationDate = app.licenseExpirationDate;
      }

      if (selectedVehicle) {
        profile.vehicle = {
          model: selectedVehicle.modelName,
          year: selectedVehicle.year,
          licensePlate: selectedVehicle.licensePlate,
        };
        selectedVehicle.assignedDriverId = driverUser._id as any;
        await selectedVehicle.save();
      }

      profile.approvalStatus = "APPROVED";
      await profile.save();

      res.status(200).json({
        success: true,
        data: {
          application: app,
          driverProfile: profile,
          driverId: driverUser._id.toString(),
          userId: driverUser._id.toString(),
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const fleetController = new FleetController();
