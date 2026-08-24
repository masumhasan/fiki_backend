import { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { AuditLog } from "../models/AuditLog.js";
import { DriverProfile } from "../models/DriverProfile.js";
import { Trip } from "../models/Trip.js";
import { User } from "../models/User.js";
import { Setting } from "../models/Setting.js";
import bcrypt from "bcryptjs";

const updateDriverStatusSchema = z.object({
  approvalStatus: z.enum(["APPROVED", "REJECTED"]).optional(),
  accountStatus: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});

const createTripSchema = z.object({
  // Passenger Information
  fullName: z.string().min(2, "Full name is required"),
  dateOfBirth: z.string().min(1, "Date of birth is required"),
  confirmDob: z.boolean(),
  phoneNumber: z.string().min(10, "Valid phone number is required"),
  email: z.string().email().optional().or(z.literal("")).or(z.null()),
  streetAddress: z.string().min(5, "Street address is required"),
  city: z.string().min(2, "City is required"),
  state: z.string().min(2, "State is required"),
  zipCode: z.string().min(5, "Zip code is required"),
  emergencyContactName: z.string().min(2, "Emergency contact name is required"),
  emergencyContactPhone: z.string().min(10, "Emergency contact phone is required"),
  relationship: z.string().min(1, "Relationship is required"),

  // Trip Information
  tripType: z.enum(["one-way", "round-trip"]),
  schedule: z.enum(["one-time", "recurring"]),
  pickupAddress: z.string().min(5, "Pickup address is required"),
  destinationAddress: z.string().min(5, "Destination address is required"),
  pickupDate: z.string().min(1, "Pickup date is required"),
  pickupTime: z.string().min(1, "Pickup time is required"),
  appointmentTime: z.string().optional().or(z.null()),

  // Recurring Transportation Details
  recurringStartDate: z.string().optional().or(z.null()),
  recurringEndDate: z.string().optional().or(z.null()),
  recurringDays: z.array(z.string()).optional().or(z.null()),
  recurringPickupTime: z.string().optional().or(z.null()),
  recurringAppointmentTime: z.string().optional().or(z.null()),

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
  signatureDate: z.string().min(1, "Date is required"),
  printedName: z.string().min(2, "Printed name is required"),
  relationshipToPassenger: z.string().optional().or(z.null()),
  fare: z.number().positive("Fare is required and must be positive"),
});

const assignDriverSchema = z.object({
  driverId: z.string().min(1, "Driver ID is required"),
});

const sendQuoteSchema = z.object({
  quotedFare: z.number().positive("Quoted fare must be a positive number"),
  quoteNote: z.string().max(500).optional(),
});

const respondToCounterOfferSchema = z.object({
  action: z.enum(["ACCEPT", "DECLINE"], {
    errorMap: () => ({ message: "Action must be ACCEPT or DECLINE" }),
  }),
});

export class AdminController {
  async getDriverById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, error: { code: "INVALID_ID", message: "Invalid driver ID format" } });
        return;
      }

      const user = await User.findOne({ _id: id, role: "DRIVER", deletedAt: null }).lean();
      if (!user) {
        res.status(404).json({ success: false, error: { code: "DRIVER_NOT_FOUND", message: "Driver not found" } });
        return;
      }

      const profile = await DriverProfile.findOne({ userId: user._id }).lean();

      const trips = await Trip.find({ driverId: user._id })
        .populate("passengerId", "name")
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();

      const completedTrips = trips.filter((t) => t.status === "COMPLETED");
      const totalFare = completedTrips.reduce((sum, t) => sum + (t.fare || 0), 0);

      res.status(200).json({
        success: true,
        data: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          phone: user.phone || null,
          accountStatus: user.accountStatus,
          createdAt: user.createdAt,
          profile: profile
            ? {
                licenseNumber: profile.licenseNumber || null,
                vehicle: profile.vehicle || null,
                approvalStatus: profile.approvalStatus,
                availabilityStatus: profile.availabilityStatus,
                rating: profile.rating ?? null,
                completedTripsCount: profile.completedTripsCount,
                weeklySchedule: profile.weeklySchedule || null,
                oneTimeChanges: profile.oneTimeChanges || [],
              }
            : null,
          trips: trips.map((t) => ({
            _id: t._id.toString(),
            status: t.status,
            fare: t.fare ?? null,
            pickup: t.pickupLocation?.address || null,
            dropoff: t.dropoffLocation?.address || null,
            passengerName: (t.passengerId as any)?.name || null,
            createdAt: t.createdAt,
          })),
          stats: {
            completedTrips: completedTrips.length,
            totalTrips: trips.length,
            totalFare,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async getDrivers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
      const skip = (page - 1) * limit;

      const { approvalStatus, availabilityStatus, search } = req.query;

      const userFilter: Record<string, unknown> = { role: "DRIVER", deletedAt: null };
      if (search) {
        userFilter.$or = [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ];
      }

      // If approvalStatus or availabilityStatus filter is specified, filter by DriverProfile first
      const profileQuery: Record<string, unknown> = {};
      if (approvalStatus) profileQuery.approvalStatus = approvalStatus;
      if (availabilityStatus) profileQuery.availabilityStatus = availabilityStatus;

      if (Object.keys(profileQuery).length > 0) {
        const matchingProfiles = await DriverProfile.find(profileQuery).select("userId").lean();
        const matchingUserIds = matchingProfiles.map((p) => p.userId);
        userFilter._id = { $in: matchingUserIds };
      }

      const driverUsers = await User.find(userFilter).skip(skip).limit(limit).lean();
      const totalDrivers = await User.countDocuments(userFilter);

      const userIds = driverUsers.map((u) => u._id);

      const profiles = await DriverProfile.find({ userId: { $in: userIds } }).lean();
      const profileMap = new Map(profiles.map((p) => [p.userId.toString(), p]));

      const drivers = driverUsers.map((u) => {
        const p = profileMap.get(u._id.toString());
        return {
          id: u._id.toString(),
          email: u.email,
          name: u.name,
          phone: u.phone,
          accountStatus: u.accountStatus,
          createdAt: u.createdAt,
          profile: p
            ? {
                approvalStatus: p.approvalStatus,
                availabilityStatus: p.availabilityStatus,
                vehicle: p.vehicle,
                rating: p.rating,
                completedTripsCount: p.completedTripsCount,
                weeklySchedule: p.weeklySchedule || null,
                oneTimeChanges: p.oneTimeChanges || [],
              }
            : null,
        };
      });

      res.status(200).json({
        success: true,
        data: {
          drivers,
          pagination: {
            page,
            limit,
            total: totalDrivers,
            totalPages: Math.ceil(totalDrivers / limit),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateDriverStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, error: { code: "INVALID_ID", message: "Invalid driver ID format" } });
        return;
      }

      const parsed = updateDriverStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({
          success: false,
          error: { code: "VALIDATION_FAILED", message: "Invalid status parameters", details: parsed.error.flatten().fieldErrors },
        });
        return;
      }

      const driverUser = await User.findOne({ _id: id, role: "DRIVER", deletedAt: null });
      if (!driverUser) {
        res.status(404).json({ success: false, error: { code: "DRIVER_NOT_FOUND", message: "Driver not found" } });
        return;
      }

      const previousState: Record<string, unknown> = {
        accountStatus: driverUser.accountStatus,
      };

      if (parsed.data.accountStatus) {
        driverUser.accountStatus = parsed.data.accountStatus;
        await driverUser.save();
      }

      let profile = await DriverProfile.findOne({ userId: driverUser._id });
      if (profile && parsed.data.approvalStatus) {
        previousState.approvalStatus = profile.approvalStatus;
        profile.approvalStatus = parsed.data.approvalStatus;
        await profile.save();
      }

      await AuditLog.create({
        actor: new mongoose.Types.ObjectId(req.user!.userId),
        actorRole: req.user!.role,
        action: "ADMIN_UPDATED_DRIVER_STATUS",
        resourceType: "Driver",
        resourceId: driverUser._id.toString(),
        previousState,
        newState: {
          accountStatus: driverUser.accountStatus,
          approvalStatus: profile?.approvalStatus,
        },
        requestId: req.requestId,
      });

      res.status(200).json({
        success: true,
        data: {
          id: driverUser._id.toString(),
          email: driverUser.email,
          name: driverUser.name,
          accountStatus: driverUser.accountStatus,
          approvalStatus: profile?.approvalStatus,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async createTrip(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = createTripSchema.safeParse(req.body);
      if (!parsed.success) {
        console.log("Validation error details in backend:", parsed.error.flatten().fieldErrors);
        res.status(422).json({
          success: false,
          error: { code: "VALIDATION_FAILED", message: "Invalid trip payload", details: parsed.error.flatten().fieldErrors },
        });
        return;
      }

      const tripData = parsed.data;

      // Find or create passenger user
      let passenger = await User.findOne({
        $or: [
          tripData.email ? { email: tripData.email.toLowerCase() } : undefined,
          { phone: tripData.phoneNumber }
        ].filter(Boolean) as any
      });

      if (!passenger) {
        const passwordHash = await bcrypt.hash("Test@123", 12);
        passenger = await User.create({
          name: tripData.fullName,
          email: tripData.email ? tripData.email.toLowerCase() : `manual_${Date.now()}@fikitransit.com`,
          phone: tripData.phoneNumber,
          role: "USER",
          passwordHash,
          accountStatus: "ACTIVE",
        });
      }

      const scheduledTime = tripData.pickupDate ? new Date(`${tripData.pickupDate}T${tripData.pickupTime || "09:00"}`) : undefined;

      const { fare, pickupAddress, destinationAddress, ...restOfTripData } = tripData;

      const trip = await Trip.create({
        passengerId: passenger._id,
        pickupLocation: { address: pickupAddress },
        dropoffLocation: { address: destinationAddress },
        fare: fare,
        quotedFare: fare,
        quotedAt: new Date(),
        // Since there is no negotiation for manual requests, status is set to QUOTE_ACCEPTED directly
        // making it ready for driver assignment.
        status: "QUOTE_ACCEPTED",
        scheduledTime,
        ...restOfTripData,
      });

      res.status(201).json({
        success: true,
        data: trip,
      });
    } catch (error) {
      next(error);
    }
  }

  async getTrips(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
      const skip = (page - 1) * limit;

      const { status } = req.query;
      const filter: Record<string, unknown> = {};
      if (status) filter.status = status;

      const trips = await Trip.find(filter)
        .populate("passengerId", "name email phone")
        .populate("driverId", "name email phone")
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .lean();

      const total = await Trip.countDocuments(filter);

      res.status(200).json({
        success: true,
        data: {
          trips,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async assignDriver(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const parsed = assignDriverSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({
          success: false,
          error: { code: "VALIDATION_FAILED", message: "Invalid payload", details: parsed.error.flatten().fieldErrors },
        });
        return;
      }

      const trip = await Trip.findById(id);
      if (!trip) {
        res.status(404).json({ success: false, error: { code: "TRIP_NOT_FOUND", message: "Trip not found" } });
        return;
      }

      const driver = await User.findOne({ _id: parsed.data.driverId, role: "DRIVER", accountStatus: "ACTIVE" });
      if (!driver) {
        res.status(400).json({ success: false, error: { code: "INVALID_DRIVER", message: "Driver not found or not active" } });
        return;
      }

      trip.driverId = driver._id;
      trip.status = "ACCEPTED";
      await trip.save();

      await DriverProfile.findOneAndUpdate(
        { userId: driver._id },
        { availabilityStatus: "ASSIGNED" }
      );

      const populatedTrip = await Trip.findById(trip._id)
        .populate("passengerId", "name email phone")
        .populate("driverId", "name email phone")
        .lean();

      res.status(200).json({
        success: true,
        data: populatedTrip,
      });
    } catch (error) {
      next(error);
    }
  }

  async getTripById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, error: { code: "INVALID_ID", message: "Invalid trip ID format" } });
        return;
      }

      const trip = await Trip.findById(id)
        .populate("passengerId", "name email phone")
        .populate("driverId", "name email phone")
        .lean();

      if (!trip) {
        res.status(404).json({ success: false, error: { code: "TRIP_NOT_FOUND", message: "Trip not found" } });
        return;
      }

      let driverProfile = null;
      if (trip.driverId) {
        const driverObjId = (trip.driverId as any)._id || trip.driverId;
        driverProfile = await DriverProfile.findOne({ userId: driverObjId })
          .select("vehicle rating availabilityStatus")
          .lean();
      }

      const auditLogs = await AuditLog.find({ resourceId: id })
        .sort({ timestamp: -1 })
        .lean();

      res.status(200).json({
        success: true,
        data: {
          ...trip,
          driverProfile,
          auditLogs,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async cancelTripAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, error: { code: "INVALID_ID", message: "Invalid trip ID format" } });
        return;
      }

      const trip = await Trip.findById(id);
      if (!trip) {
        res.status(404).json({ success: false, error: { code: "TRIP_NOT_FOUND", message: "Trip not found" } });
        return;
      }

      if (trip.status === "COMPLETED" || trip.status === "CANCELLED") {
        res.status(409).json({ success: false, error: { code: "INVALID_STATE", message: `Trip is already ${trip.status}` } });
        return;
      }

      trip.status = "CANCELLED";
      trip.cancelledAt = new Date();
      trip.cancellationReason = req.body?.reason || "Cancelled by admin";
      await trip.save();

      await AuditLog.create({
        actor: new mongoose.Types.ObjectId(req.user!.userId),
        actorRole: req.user!.role,
        action: "ADMIN_CANCELLED_TRIP",
        resourceType: "Trip",
        resourceId: trip._id.toString(),
        newState: { status: "CANCELLED" },
        requestId: req.requestId,
      });

      res.status(200).json({ success: true, data: trip });
    } catch (error) {
      next(error);
    }
  }

  async sendQuote(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, error: { code: "INVALID_ID", message: "Invalid trip ID format" } });
        return;
      }

      const parsed = sendQuoteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({
          success: false,
          error: { code: "VALIDATION_FAILED", message: "Invalid quote payload", details: parsed.error.flatten().fieldErrors },
        });
        return;
      }

      const trip = await Trip.findById(id);
      if (!trip) {
        res.status(404).json({ success: false, error: { code: "TRIP_NOT_FOUND", message: "Trip not found" } });
        return;
      }

      const allowedStatuses: string[] = ["REQUESTED", "QUOTE_COUNTERED"];
      if (!allowedStatuses.includes(trip.status)) {
        res.status(409).json({
          success: false,
          error: { code: "INVALID_TRIP_STATE", message: `Cannot send a quote when trip status is '${trip.status}'` },
        });
        return;
      }

      const previousStatus = trip.status;
      trip.quotedFare = parsed.data.quotedFare;
      trip.quotedAt = new Date();
      trip.quoteNote = parsed.data.quoteNote;
      trip.status = "QUOTE_SENT";
      await trip.save();

      await AuditLog.create({
        actor: new mongoose.Types.ObjectId(req.user!.userId),
        actorRole: req.user!.role,
        action: "ADMIN_SENT_QUOTE",
        resourceType: "Trip",
        resourceId: trip._id.toString(),
        previousState: { status: previousStatus },
        newState: { status: trip.status, quotedFare: trip.quotedFare },
        requestId: req.requestId,
      });

      res.status(200).json({
        success: true,
        data: {
          id: trip._id.toString(),
          status: trip.status,
          quotedFare: trip.quotedFare,
          quotedAt: trip.quotedAt,
          quoteNote: trip.quoteNote,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async respondToCounterOffer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, error: { code: "INVALID_ID", message: "Invalid trip ID format" } });
        return;
      }

      const parsed = respondToCounterOfferSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({
          success: false,
          error: { code: "VALIDATION_FAILED", message: "Invalid action", details: parsed.error.flatten().fieldErrors },
        });
        return;
      }

      const trip = await Trip.findById(id);
      if (!trip) {
        res.status(404).json({ success: false, error: { code: "TRIP_NOT_FOUND", message: "Trip not found" } });
        return;
      }

      if (trip.status !== "QUOTE_COUNTERED") {
        res.status(409).json({
          success: false,
          error: { code: "INVALID_TRIP_STATE", message: `Trip is not in QUOTE_COUNTERED status` },
        });
        return;
      }

      const previousStatus = trip.status;
      const { action } = parsed.data;

      if (action === "ACCEPT") {
        trip.status = "QUOTE_ACCEPTED";
        if (trip.counterOffer) {
          trip.fare = trip.counterOffer;
          trip.quotedFare = trip.counterOffer;
        }
      } else {
        trip.status = "QUOTE_DENIED";
        trip.cancelledAt = new Date();
        trip.cancellationReason = "Admin declined counter offer";
      }

      await trip.save();

      await AuditLog.create({
        actor: new mongoose.Types.ObjectId(req.user!.userId),
        actorRole: req.user!.role,
        action: `ADMIN_${action}ED_COUNTER_OFFER`,
        resourceType: "Trip",
        resourceId: trip._id.toString(),
        previousState: { status: previousStatus },
        newState: { status: trip.status, fare: trip.fare },
        requestId: req.requestId,
      });

      res.status(200).json({
        success: true,
        data: trip,
      });
    } catch (error) {
      next(error);
    }
  }

  async getAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      const startOfWeek = new Date(todayStart);
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()); // Sunday start of week
      
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfYear = new Date(now.getFullYear(), 0, 1);

      // 1. Basic counts & totals
      const totalTrips = await Trip.countDocuments();
      const completedTrips = await Trip.countDocuments({ status: "COMPLETED" });
      const pendingRequests = await Trip.countDocuments({ status: { $in: ["REQUESTED", "QUOTE_COUNTERED", "QUOTE_SENT"] } });
      const cancelledTrips = await Trip.countDocuments({ status: "CANCELLED" });
      const rejectedTrips = await Trip.countDocuments({ status: "QUOTE_DENIED" });

      const totalDrivers = await User.countDocuments({ role: "DRIVER", deletedAt: null });
      const activeDriversCount = await DriverProfile.countDocuments({ availabilityStatus: { $in: ["ONLINE", "ASSIGNED", "ON_TRIP"] } });
      const onTripDriversCount = await DriverProfile.countDocuments({ availabilityStatus: "ON_TRIP" });

      const totalPassengers = await User.countDocuments({ role: "PASSENGER", deletedAt: null });
      const newPassengersThisWeek = await User.countDocuments({ role: "PASSENGER", deletedAt: null, createdAt: { $gte: startOfWeek } });

      // Revenue Aggregations
      const completedRevenueAgg = await Trip.aggregate([
        { $match: { status: "COMPLETED" } },
        { $group: { _id: null, total: { $sum: "$fare" } } }
      ]);
      const totalRevenue = completedRevenueAgg[0]?.total || 0;

      const outstandingAgg = await Trip.aggregate([
        { $match: { status: { $nin: ["COMPLETED", "CANCELLED", "QUOTE_DENIED"] } } },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$quotedFare", { $ifNull: ["$fare", 0] }] } } } }
      ]);
      const outstandingPayments = outstandingAgg[0]?.total || 0;

      // Period Revenue Summary
      const todayRevenueAgg = await Trip.aggregate([
        { $match: { status: "COMPLETED", completedAt: { $gte: todayStart } } },
        { $group: { _id: null, total: { $sum: "$fare" } } }
      ]);
      const todayRevenue = todayRevenueAgg[0]?.total || 0;

      const weeklyRevenueAgg = await Trip.aggregate([
        { $match: { status: "COMPLETED", completedAt: { $gte: startOfWeek } } },
        { $group: { _id: null, total: { $sum: "$fare" } } }
      ]);
      const weeklyRevenue = weeklyRevenueAgg[0]?.total || 0;

      const monthlyRevenueAgg = await Trip.aggregate([
        { $match: { status: "COMPLETED", completedAt: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: "$fare" } } }
      ]);
      const monthlyRevenue = monthlyRevenueAgg[0]?.total || 0;

      const yearlyRevenueAgg = await Trip.aggregate([
        { $match: { status: "COMPLETED", completedAt: { $gte: startOfYear } } },
        { $group: { _id: null, total: { $sum: "$fare" } } }
      ]);
      const yearlyRevenue = yearlyRevenueAgg[0]?.total || 0;

      const avgRidePrice = completedTrips > 0 ? (totalRevenue / completedTrips) : 0;

      // 2. Monthly Ride Performance (12 Months Jan - Dec of current year)
      const monthlyPerformanceAgg = await Trip.aggregate([
        { $match: { createdAt: { $gte: startOfYear } } },
        {
          $group: {
            _id: { $month: "$createdAt" },
            requested: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] }
            }
          }
        }
      ]);
      
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const monthlyPerformanceMap = new Map(monthlyPerformanceAgg.map(m => [m._id, m]));
      const monthlyRidePerformance = monthNames.map((month, idx) => {
        const item = monthlyPerformanceMap.get(idx + 1);
        return {
          month,
          requested: item?.requested || 0,
          completed: item?.completed || 0,
        };
      });

      // 3. Revenue Overview Monthly (12 Months)
      const revenueOverviewAgg = await Trip.aggregate([
        { $match: { createdAt: { $gte: startOfYear } } },
        {
          $group: {
            _id: { $month: "$createdAt" },
            monthlyRevenue: {
              $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, "$fare", 0] }
            },
            outstanding: {
              $sum: {
                $cond: [
                  { $not: [{ $in: ["$status", ["COMPLETED", "CANCELLED", "QUOTE_DENIED"]] }] },
                  { $ifNull: ["$quotedFare", { $ifNull: ["$fare", 0] }] },
                  0
                ]

              }
            }
          }
        }
      ]);
      const revenueOverviewMap = new Map(revenueOverviewAgg.map(r => [r._id, r]));
      const revenueOverview = monthNames.map((month, idx) => {
        const item = revenueOverviewMap.get(idx + 1);
        return {
          month,
          monthlyRevenue: item?.monthlyRevenue || 0,
          outstanding: item?.outstanding || 0,
        };
      });

      // 4. Top Drivers
      const topDriversAgg = await Trip.aggregate([
        { $match: { status: "COMPLETED", driverId: { $ne: null } } },
        {
          $group: {
            _id: "$driverId",
            tripsCount: { $sum: 1 },
            revenueSum: { $sum: "$fare" }
          }
        },
        { $sort: { tripsCount: -1 } },
        { $limit: 10 }
      ]);

      const topDriverUserIds = topDriversAgg.map(d => d._id);
      const driverUsers = await User.find({ _id: { $in: topDriverUserIds } }).lean();
      const driverProfiles = await DriverProfile.find({ userId: { $in: topDriverUserIds } }).lean();
      
      const userMap = new Map(driverUsers.map(u => [u._id.toString(), u]));
      const profileMap = new Map(driverProfiles.map(p => [p.userId.toString(), p]));

      let topDrivers = topDriversAgg.map(item => {
        const uidStr = item._id.toString();
        const u = userMap.get(uidStr);
        const p = profileMap.get(uidStr);
        const name = u?.name || "Driver";
        const initials = name.split(" ").map(n => n[0]).join("").toUpperCase().substring(0, 2) || "DR";
        
        let statusStr = "Active";
        if (p?.availabilityStatus === "ASSIGNED") statusStr = "On Trip";
        else if (p?.availabilityStatus === "OFFLINE" || p?.availabilityStatus === "UNAVAILABLE") statusStr = "Off Duty";


        return {
          id: uidStr,
          initials,
          name,
          trips: item.tripsCount,
          rating: (p?.rating || 4.8).toFixed(1),
          revenue: `$${item.revenueSum.toLocaleString()}`,
          revenueVal: item.revenueSum,
          status: statusStr,
        };
      });

      // Fallback: If no trips completed yet, fetch approved drivers
      if (topDrivers.length === 0) {
        const approvedProfiles = await DriverProfile.find({ approvalStatus: "APPROVED" }).limit(6).lean();
        const appUserIds = approvedProfiles.map(p => p.userId);
        const appUsers = await User.find({ _id: { $in: appUserIds } }).lean();
        const appUserMap = new Map(appUsers.map(u => [u._id.toString(), u]));

        topDrivers = approvedProfiles.map(p => {
          const uidStr = p.userId.toString();
          const u = appUserMap.get(uidStr);
          const name = u?.name || "Driver";
          const initials = name.split(" ").map(n => n[0]).join("").toUpperCase().substring(0, 2) || "DR";
          let statusStr = "Active";
          if (p.availabilityStatus === "ASSIGNED") statusStr = "On Trip";
          else if (p.availabilityStatus === "OFFLINE" || p.availabilityStatus === "UNAVAILABLE") statusStr = "Off Duty";


          return {
            id: uidStr,
            initials,
            name,
            trips: p.completedTripsCount || 0,
            rating: (p.rating || 4.8).toFixed(1),
            revenue: "$0",
            revenueVal: 0,
            status: statusStr,
          };
        });
      }

      // 5. Recent Ride Requests
      const recentTripsDocs = await Trip.find()
        .populate("passengerId", "name")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();

      const recentRideRequests = recentTripsDocs.map(t => {
        const rideId = `FT-${t._id.toString().substring(t._id.toString().length - 4).toUpperCase()}`;
        const passengerName = t.fullName || (t.passengerId as any)?.name || "Passenger";
        const dest = t.dropoffLocation?.address || t.returnDestinationAddress || "Destination";
        
        let statusStr = "Pending";
        if (t.status === "COMPLETED") statusStr = "Completed";
        else if (["ACCEPTED", "DRIVER_ARRIVING", "DRIVER_ARRIVED", "IN_PROGRESS"].includes(t.status)) statusStr = "In Progress";
        else if (t.status === "CANCELLED" || t.status === "QUOTE_DENIED") statusStr = "Cancelled";
        
        const priceVal = t.fare || t.quotedFare || 0;
        const priceStr = `$${priceVal.toFixed(2)}`;

        return {
          id: rideId,
          rawId: t._id.toString(),
          passenger: passengerName,
          destination: dest,
          status: statusStr,
          price: priceStr,
          priceVal,
        };
      });

      res.status(200).json({
        success: true,
        data: {
          metrics: {
            todayTrips: await Trip.countDocuments({ createdAt: { $gte: todayStart } }),
            pendingRequests,
            activeDrivers: activeDriversCount,
            onTripDrivers: onTripDriversCount,
            completedTrips,
            cancelledTrips,
            rejectedTrips,
            totalTrips,
            totalDrivers,
            totalPassengers,
            newPassengersThisWeek,
            totalRevenue,
            outstandingPayments,
          },
          revenueSummary: {
            todayRevenue,
            weeklyRevenue,
            monthlyRevenue,
            yearlyRevenue,
            outstandingBalance: outstandingPayments,
            avgRidePrice,
          },
          monthlyRidePerformance,
          revenueOverview,
          topDrivers,
          recentRideRequests,
        },
      });
    } catch (error) {
      next(error);
    }
  }


  async deleteDriver(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, error: { code: "INVALID_ID", message: "Invalid driver ID format" } });
        return;
      }

      const driverUser = await User.findOne({ _id: id, role: "DRIVER" });
      if (!driverUser) {
        res.status(404).json({ success: false, error: { code: "DRIVER_NOT_FOUND", message: "Driver not found" } });
        return;
      }

      await User.findByIdAndDelete(id);
      await DriverProfile.deleteMany({ userId: id });

      res.status(200).json({
        success: true,
        message: "Driver deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  async updateDriverSchedule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, error: { code: "INVALID_ID", message: "Invalid driver ID format" } });
        return;
      }

      const { weeklySchedule } = req.body;
      if (!Array.isArray(weeklySchedule)) {
        res.status(422).json({ success: false, error: { code: "VALIDATION_FAILED", message: "weeklySchedule must be an array" } });
        return;
      }

      const profile = await DriverProfile.findOneAndUpdate(
        { userId: new mongoose.Types.ObjectId(id) },
        { weeklySchedule },
        { new: true }
      );

      if (!profile) {
        res.status(404).json({ success: false, error: { code: "PROFILE_NOT_FOUND", message: "Driver profile not found" } });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          id: id,
          weeklySchedule: profile.weeklySchedule,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async addOneTimeChange(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, error: { code: "INVALID_ID", message: "Invalid driver ID format" } });
        return;
      }

      const { date, working, startTime, endTime, reason } = req.body;
      if (!date) {
        res.status(422).json({ success: false, error: { code: "VALIDATION_FAILED", message: "date is required" } });
        return;
      }

      const parsedDate = new Date(date);
      if (isNaN(parsedDate.getTime())) {
        res.status(422).json({ success: false, error: { code: "VALIDATION_FAILED", message: "invalid date format" } });
        return;
      }

      const profile = await DriverProfile.findOne({ userId: new mongoose.Types.ObjectId(id) });
      if (!profile) {
        res.status(404).json({ success: false, error: { code: "PROFILE_NOT_FOUND", message: "Driver profile not found" } });
        return;
      }

      const cleanChanges = (profile.oneTimeChanges || []).filter(
        (c: any) => new Date(c.date).toDateString() !== parsedDate.toDateString()
      );

      cleanChanges.push({
        date: parsedDate,
        working,
        startTime: working ? startTime : undefined,
        endTime: working ? endTime : undefined,
        reason,
      } as any);

      profile.oneTimeChanges = cleanChanges;
      await profile.save();

      res.status(200).json({
        success: true,
        data: {
          id,
          oneTimeChanges: profile.oneTimeChanges,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async getOneTimeChanges(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, error: { code: "INVALID_ID", message: "Invalid driver ID format" } });
        return;
      }

      const profile = await DriverProfile.findOne({ userId: new mongoose.Types.ObjectId(id) }).lean();
      if (!profile) {
        res.status(404).json({ success: false, error: { code: "PROFILE_NOT_FOUND", message: "Driver profile not found" } });
        return;
      }

      res.status(200).json({
        success: true,
        data: { oneTimeChanges: profile.oneTimeChanges || [] },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateOneTimeChange(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id, changeId } = req.params as { id: string; changeId: string };
      if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(changeId)) {
        res.status(400).json({ success: false, error: { code: "INVALID_ID", message: "Invalid ID format" } });
        return;
      }

      const { date, working, startTime, endTime, reason } = req.body;

      const profile = await DriverProfile.findOne({ userId: new mongoose.Types.ObjectId(id) });
      if (!profile) {
        res.status(404).json({ success: false, error: { code: "PROFILE_NOT_FOUND", message: "Driver profile not found" } });
        return;
      }

      const change = (profile.oneTimeChanges as any[]).find(
        (c: any) => c._id?.toString() === changeId
      );
      if (!change) {
        res.status(404).json({ success: false, error: { code: "CHANGE_NOT_FOUND", message: "One-time change not found" } });
        return;
      }

      if (date) change.date = new Date(date);
      if (typeof working === "boolean") change.working = working;
      change.startTime = working ? (startTime ?? change.startTime) : undefined;
      change.endTime = working ? (endTime ?? change.endTime) : undefined;
      change.reason = reason ?? change.reason;

      profile.markModified("oneTimeChanges");
      await profile.save();

      res.status(200).json({
        success: true,
        data: { oneTimeChanges: profile.oneTimeChanges },
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteOneTimeChange(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id, changeId } = req.params as { id: string; changeId: string };
      if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(changeId)) {
        res.status(400).json({ success: false, error: { code: "INVALID_ID", message: "Invalid ID format" } });
        return;
      }

      const profile = await DriverProfile.findOne({ userId: new mongoose.Types.ObjectId(id) });
      if (!profile) {
        res.status(404).json({ success: false, error: { code: "PROFILE_NOT_FOUND", message: "Driver profile not found" } });
        return;
      }

      const before = (profile.oneTimeChanges || []).length;
      profile.oneTimeChanges = (profile.oneTimeChanges as any[]).filter(
        (c: any) => c._id?.toString() !== changeId
      ) as any;

      if (profile.oneTimeChanges.length === before) {
        res.status(404).json({ success: false, error: { code: "CHANGE_NOT_FOUND", message: "One-time change not found" } });
        return;
      }

      await profile.save();

      res.status(200).json({
        success: true,
        data: { oneTimeChanges: profile.oneTimeChanges },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateDispatchNumber(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { dispatchNumber } = req.body;
      if (!dispatchNumber) {
        res.status(422).json({ success: false, error: { code: "VALIDATION_FAILED", message: "dispatchNumber is required" } });
        return;
      }

      const setting = await Setting.findOneAndUpdate(
        { key: "dispatchNumber" },
        { value: dispatchNumber },
        { new: true, upsert: true }
      );

      res.status(200).json({
        success: true,
        data: { dispatchNumber: setting.value },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const adminController = new AdminController();
