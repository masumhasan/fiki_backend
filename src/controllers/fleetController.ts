import { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { VehicleReport } from "../models/VehicleReport.js";
import { DriverApplication } from "../models/DriverApplication.js";
import { User } from "../models/User.js";
import { DriverProfile } from "../models/DriverProfile.js";
import { Vehicle } from "../models/Vehicle.js";

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
  async getVehicleReports(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      let reports = await VehicleReport.find().sort({ createdAt: -1 });

      // Seed initial sample report if empty
      if (reports.length === 0) {
        const seeded = await VehicleReport.create({
          vehicleId: "V-101",
          make: "Toyota",
          vehicleModel: "Sienna 2023",
          licensePlate: "MIA-4821",
          inspectionStatus: "PASS",
          fuelLevelPercentage: 78,
          wheelchairLiftOperational: true,
          notes: "Regular 30-day inspection completed.",
          inspectorName: "Admin Inspector",
        });
        reports = [seeded];
      }

      res.status(200).json({
        success: true,
        data: reports,
      });
    } catch (error) {
      next(error);
    }
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
          approvalStatus: "APPROVED",
          availabilityStatus: "ONLINE",
        });
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
          driverId: profile._id,
          userId: driverUser._id,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const fleetController = new FleetController();
