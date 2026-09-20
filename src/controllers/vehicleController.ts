import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { Vehicle } from "../models/Vehicle.js";

import { DriverShift } from "../models/DriverShift.js";
import { DriverProfile } from "../models/DriverProfile.js";

const createVehicleSchema = z.object({
  modelName: z.string().min(1, "Model name is required"),
  licensePlate: z.string().min(1, "License plate is required"),
  vin: z.string().length(17, "VIN must contain 17 characters"),
  year: z.number().min(1900).max(2100),
  plateExpirationDate: z.string().min(1, "Plate expiration date is required"),
  imageUrl: z.string().optional(),
});

export class VehicleController {
  async getVehicles(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      let vehicles = await Vehicle.find().sort({ createdAt: -1 });

      // Seed initial sample vehicles if collection is empty
      if (vehicles.length === 0) {
        const seeded = await Vehicle.create({
          modelName: "BMW",
          licensePlate: "1254-54285",
          vin: "1245-5698500000000",
          year: 2012,
          fleetId: "#327",
          status: "Active",
        });
        vehicles = [seeded];
      }

      // Fetch profiles and shifts to calculate current odometer per vehicle
      const [profiles, shifts] = await Promise.all([
        DriverProfile.find().lean(),
        DriverShift.find().sort({ startedAt: -1, createdAt: -1 }).lean(),
      ]);

      const vehiclesWithOdometer = vehicles.map((v) => {
        const vObj = (v as any).toObject ? (v as any).toObject() : { ...v };
        const vIdStr = vObj._id.toString();
        const vPlate = (vObj.licensePlate || "").trim().toLowerCase();

        // Collect all driver user IDs assigned to this vehicle
        const assignedDriverIds = new Set<string>();
        if (vObj.assignedDriverId) {
          assignedDriverIds.add(vObj.assignedDriverId.toString());
        }
        profiles
          .filter(
            (p: any) =>
              p.vehicleId?.toString() === vIdStr ||
              (p.vehicle?.licensePlate && p.vehicle.licensePlate.trim().toLowerCase() === vPlate)
          )
          .forEach((p: any) => assignedDriverIds.add(p.userId.toString()));

        // Find latest shift matching this vehicle or its assigned driver(s)
        const matchingShift = shifts.find((s: any) => {
          const shiftPlate = s.vehicleInfo?.licensePlate?.trim().toLowerCase();
          if (shiftPlate && shiftPlate === vPlate) {
            return true;
          }
          if (assignedDriverIds.has(s.driverId?.toString())) {
            if (!shiftPlate || shiftPlate === "000000" || shiftPlate === "fkt-1234" || shiftPlate === vPlate) {
              return true;
            }
          }
          return false;
        });

        const currentOdometer = matchingShift
          ? (matchingShift.endingOdometer != null && matchingShift.endingOdometer > 0
              ? matchingShift.endingOdometer
              : (matchingShift.startingOdometer ?? null))
          : null;

        return {
          ...vObj,
          currentOdometer,
        };
      });

      res.status(200).json({
        success: true,
        data: vehiclesWithOdometer,
      });
    } catch (error) {
      next(error);
    }
  }

  async createVehicle(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = createVehicleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({
          success: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid vehicle data",
            details: parsed.error.flatten().fieldErrors,
          },
        });
        return;
      }

      const { modelName, licensePlate, vin, year, plateExpirationDate, imageUrl } = parsed.data;

      // Auto-generate fleet ID
      const fleetId = `#${Math.floor(100 + Math.random() * 900)}`;

      const newVehicle = await Vehicle.create({
        modelName,
        licensePlate,
        vin,
        year,
        plateExpirationDate,
        imageUrl,
        fleetId,
        status: "Active",
      });

      res.status(201).json({
        success: true,
        data: newVehicle,
      });
    } catch (error: any) {
      if (error.code === 11000) {
        res.status(409).json({
          success: false,
          error: {
            code: "DUPLICATE_VIN",
            message: "A vehicle with this VIN already exists",
          },
        });
        return;
      }
      next(error);
    }
  }

  async updateVehicle(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const parsed = createVehicleSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({
          success: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid vehicle update payload",
            details: parsed.error.flatten().fieldErrors,
          },
        });
        return;
      }

      const updated = await Vehicle.findByIdAndUpdate(id, parsed.data, { new: true });
      if (!updated) {
        res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Vehicle not found" },
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: updated,
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteVehicle(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const deleted = await Vehicle.findByIdAndDelete(id);
      if (!deleted) {
        res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Vehicle not found" },
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Vehicle deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  }
}

export const vehicleController = new VehicleController();
