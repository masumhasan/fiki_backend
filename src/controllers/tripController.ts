import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { Trip } from "../models/Trip.js";

const createRideSchema = z.object({
  pickupAddress: z.string().min(1, "Pickup address is required"),
  dropoffAddress: z.string().min(1, "Dropoff address is required"),
  fare: z.number().positive().optional(),
});

export class TripController {
  async requestTrip(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Not authenticated" } });
        return;
      }

      const parsed = createRideSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({
          success: false,
          error: { code: "VALIDATION_FAILED", message: "Invalid ride request payload", details: parsed.error.flatten().fieldErrors },
        });
        return;
      }

      const { pickupAddress, dropoffAddress, fare } = parsed.data;

      const trip = await Trip.create({
        passengerId: req.user.userId,
        pickupLocation: { address: pickupAddress },
        dropoffLocation: { address: dropoffAddress },
        fare: fare || 25.0,
        status: "REQUESTED",
      });

      res.status(201).json({
        success: true,
        data: trip,
      });
    } catch (error) {
      next(error);
    }
  }

  async getMyTrips(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Not authenticated" } });
        return;
      }

      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
      const skip = (page - 1) * limit;

      const trips = await Trip.find({ passengerId: req.user.userId })
        .populate("driverId", "name email phone")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      const total = await Trip.countDocuments({ passengerId: req.user.userId });

      res.status(200).json({
        success: true,
        data: {
          trips,
          pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async cancelTrip(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Not authenticated" } });
        return;
      }

      const id = req.params.id as string;
      const trip = await Trip.findOne({ _id: id, passengerId: req.user.userId });

      if (!trip) {
        res.status(404).json({ success: false, error: { code: "TRIP_NOT_FOUND", message: "Trip not found" } });
        return;
      }

      if (trip.status === "COMPLETED" || trip.status === "CANCELLED" || trip.status === "IN_PROGRESS") {
        res.status(400).json({
          success: false,
          error: { code: "CANNOT_CANCEL", message: `Trip in '${trip.status}' status cannot be cancelled` },
        });
        return;
      }

      trip.status = "CANCELLED";
      trip.cancelledAt = new Date();
      await trip.save();

      res.status(200).json({
        success: true,
        data: trip,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const tripController = new TripController();
