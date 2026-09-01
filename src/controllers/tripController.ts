import mongoose from "mongoose";
import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { AuditLog } from "../models/AuditLog.js";
import { Trip } from "../models/Trip.js";
import { generateRecurringTripsForMaster } from "../utils/recurringTripUtils.js";

const createRideSchema = z.object({
  // Passenger Information
  fullName: z.string().min(2, "Full name is required"),
  dateOfBirth: z.string().min(1, "Date of birth is required"),
  confirmDob: z.boolean().optional(),
  phoneNumber: z.string().min(10, "Valid phone number is required"),
  email: z.string().email().optional().or(z.literal("")).or(z.null()),
  streetAddress: z.string().optional().or(z.literal("")).or(z.null()),
  city: z.string().optional().or(z.literal("")).or(z.null()),
  state: z.string().optional().or(z.literal("")).or(z.null()),
  zipCode: z.string().optional().or(z.literal("")).or(z.null()),
  emergencyContactName: z.string().min(2, "Emergency contact name is required"),
  emergencyContactPhone: z.string().min(10, "Emergency contact phone is required"),
  relationship: z.string().min(1, "Relationship is required"),

  // Trip Information
  tripType: z.enum(["one-way", "round-trip"]),
  schedule: z.enum(["one-time", "recurring"]),
  pickupAddress: z.string().min(5, "Pickup address is required"),
  destinationAddress: z.string().min(5, "Destination address is required"),
  startDate: z.string().optional().or(z.null()),
  endDate: z.string().optional().or(z.null()),
  pickupDate: z.string().optional().or(z.null()),
  pickupTime: z.string().min(1, "Pickup time is required"),
  appointmentTime: z.string().optional().or(z.literal("")).or(z.null()),

  // Recurring Transportation Details
  recurringStartDate: z.string().optional().or(z.null()),
  recurringEndDate: z.string().optional().or(z.null()),
  recurringDays: z.array(z.string()).optional().or(z.null()),
  recurringPickupTime: z.string().optional().or(z.null()),
  recurringAppointmentTime: z.string().optional().or(z.literal("")).or(z.null()),

  // Return Trip Details (Round Trip)
  returnPickupAddress: z.string().optional().or(z.null()),
  returnDestinationAddress: z.string().optional().or(z.null()),
  returnDate: z.string().optional().or(z.null()),
  returnPickupTime: z.string().optional().or(z.null()),
  driverNotes: z.string().optional().or(z.null()),

  // Mobility & Special Needs
  mobilityOptions: z.array(z.string()).optional().or(z.null()),
  specialInstructions: z.string().optional().or(z.null()),
  accessInformation: z.string().optional().or(z.null()),

  // Insurance / Payment
  insuranceName: z.string().optional().or(z.null()),
  authNumber: z.string().optional().or(z.null()),
  privatePay: z.boolean().default(false),

  // Guardian Information
  guardianName: z.string().optional().or(z.null()),
  guardianPhone: z.string().optional().or(z.null()),
  guardianEmail: z.string().email().optional().or(z.literal("")).or(z.null()),

  // Consents & Agreements
  consentPhoto: z.boolean(),
  consentTransport: z.boolean(),
  consentEsignature: z.boolean(),
  consentHipaa: z.boolean(),

  // Signature
  signature: z.string().min(1, "Signature is required"),
  signatureDate: z.string().optional().or(z.literal("")).or(z.null()),
  printedName: z.string().min(2, "Printed name is required"),
  relationshipToPassenger: z.string().optional(),
  fare: z.number().positive().optional(),
  requestSource: z.string().optional(),
});

const respondToQuoteSchema = z.object({
  action: z.enum(["ACCEPT", "DENY", "COUNTER"], {
    errorMap: () => ({ message: "Action must be ACCEPT, DENY, or COUNTER" }),
  }),
  counterOffer: z.number().positive("Counter offer must be a positive number").optional(),
  note: z.string().max(500).optional(),
}).refine(
  (data) => data.action !== "COUNTER" || (data.counterOffer !== undefined),
  { message: "counterOffer is required when action is COUNTER", path: ["counterOffer"] }
);

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

      const tripData = parsed.data;
      const sDate = tripData.startDate || tripData.pickupDate || tripData.recurringStartDate;
      const eDate = tripData.endDate || tripData.returnDate || tripData.recurringEndDate;
      const scheduledTime = sDate ? new Date(`${sDate}T${tripData.pickupTime || "09:00"}`) : undefined;

      const trip = await Trip.create({
        passengerId: req.user.userId,
        pickupLocation: { address: tripData.pickupAddress },
        dropoffLocation: { address: tripData.destinationAddress },
        fare: tripData.fare,
        status: "REQUESTED",
        scheduledTime,
        startDate: sDate,
        endDate: eDate,
        pickupDate: sDate || tripData.pickupDate,
        returnDate: eDate || tripData.returnDate,
        recurringStartDate: sDate || tripData.recurringStartDate,
        recurringEndDate: eDate || tripData.recurringEndDate,
        requestSource: tripData.requestSource || "LANDING",
        ...tripData,
      });

      await generateRecurringTripsForMaster(trip);

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

  async respondToQuote(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Not authenticated" } });
        return;
      }

      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, error: { code: "INVALID_ID", message: "Invalid trip ID format" } });
        return;
      }

      const parsed = respondToQuoteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({
          success: false,
          error: { code: "VALIDATION_FAILED", message: "Invalid quote response", details: parsed.error.flatten().fieldErrors },
        });
        return;
      }

      const trip = await Trip.findOne({ _id: id, passengerId: req.user.userId });
      if (!trip) {
        res.status(404).json({ success: false, error: { code: "TRIP_NOT_FOUND", message: "Trip not found" } });
        return;
      }

      if (trip.status !== "QUOTE_SENT") {
        res.status(409).json({
          success: false,
          error: { code: "INVALID_TRIP_STATE", message: `Cannot respond to a quote when trip status is '${trip.status}'` },
        });
        return;
      }

      const { action, counterOffer, note } = parsed.data;
      const previousStatus = trip.status;

      if (action === "ACCEPT") {
        trip.status = "QUOTE_ACCEPTED";
        trip.fare = trip.quotedFare;
      } else if (action === "DENY") {
        trip.status = "QUOTE_DENIED";
        trip.cancelledAt = new Date();
        trip.cancellationReason = note || "Passenger declined quote";
      } else {
        trip.status = "QUOTE_COUNTERED";
        trip.counterOffer = counterOffer;
        trip.counterOfferedAt = new Date();
        trip.counterOfferNote = note;
      }

      await trip.save();

      await AuditLog.create({
        actor: new mongoose.Types.ObjectId(req.user.userId),
        actorRole: req.user.role,
        action: `PASSENGER_${action}ED_QUOTE`,
        resourceType: "Trip",
        resourceId: trip._id.toString(),
        previousState: { status: previousStatus },
        newState: { status: trip.status, counterOffer: trip.counterOffer },
        requestId: req.requestId,
      });

      res.status(200).json({
        success: true,
        data: {
          id: trip._id.toString(),
          status: trip.status,
          quotedFare: trip.quotedFare,
          counterOffer: trip.counterOffer,
          fare: trip.fare,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const tripController = new TripController();
