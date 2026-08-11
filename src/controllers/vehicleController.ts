import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { Vehicle } from "../models/Vehicle.js";

const createVehicleSchema = z.object({
  modelName: z.string().min(1, "Model name is required"),
  licensePlate: z.string().min(1, "License plate is required"),
  vin: z.string().length(17, "VIN must contain 17 characters"),
  year: z.number().min(1900).max(2100),
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

      res.status(200).json({
        success: true,
        data: vehicles,
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

      const { modelName, licensePlate, vin, year } = parsed.data;

      // Auto-generate fleet ID
      const fleetId = `#${Math.floor(100 + Math.random() * 900)}`;

      const newVehicle = await Vehicle.create({
        modelName,
        licensePlate,
        vin,
        year,
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
