import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { VehicleReport } from "../models/VehicleReport.js";
import { DriverApplication } from "../models/DriverApplication.js";

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
}

export const fleetController = new FleetController();
