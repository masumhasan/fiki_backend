import { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { Trip } from "../../models/Trip.js";
import { User } from "../../models/User.js";
import { DriverProfile } from "../../models/DriverProfile.js";
import { DriverShift } from "../../models/DriverShift.js";
import { AuditLog } from "../../models/AuditLog.js";
import { generateRecurringTripsForMaster } from "../../utils/recurringTripUtils.js";
import { parseCentralDateTime, getCentralTodayStr, getCentralTomorrowStr, getCentralDayBounds } from "../../utils/dateUtils.js";
import { resolveDriverProfile, syncDriverProfileWithApplication } from "./adminDriverUtils.js";

const createTripSchema = z.object({
  // Passenger Information
  passengerAvatarUrl: z.string().optional().or(z.null()),
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

  // Signature (optional for manual requests)
  signature: z.string().optional().or(z.literal("")).or(z.null()),
  signatureDate: z.string().optional().or(z.literal("")).or(z.null()),
  printedName: z.string().optional().or(z.literal("")).or(z.null()),
  relationshipToPassenger: z.string().optional().or(z.null()),
  fare: z.number().positive("Fare is required and must be positive"),

  // Metadata & Case Manager Info
  requestSource: z.string().optional(),
  caseManagerName: z.string().optional().or(z.literal("")).or(z.null()),
  caseManagerPhone: z.string().optional().or(z.literal("")).or(z.null()),
  caseManagerEmail: z.string().email().optional().or(z.literal("")).or(z.null()),
});

const assignDriverSchema = z.object({
  driverId: z.string().nullable().optional(),
});

const sendQuoteSchema = z.object({
  quotedFare: z.number().positive("Quoted fare must be a positive number"),
  quoteNote: z.string().max(500).optional(),
  quoteBreakdown: z
    .object({
      baseFare: z.number().optional(),
      distance: z.number().optional(),
      ratePerMile: z.number().optional(),
      extraServices: z.number().optional(),
      discount: z.number().optional(),
      taxPercent: z.number().optional(),
    })
    .optional(),
});

const respondToCounterOfferSchema = z.object({
  action: z.enum(["ACCEPT", "DECLINE"], {
    errorMap: () => ({ message: "Action must be ACCEPT or DECLINE" }),
  }),
});


export class AdminTripController {
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

      const sDate = tripData.startDate || tripData.pickupDate || tripData.recurringStartDate;
      const eDate = tripData.endDate || tripData.returnDate || tripData.recurringEndDate;
      const scheduledTime = sDate ? parseCentralDateTime(tripData.pickupTime || "09:00", sDate) : undefined;

      const {
        fare,
        pickupAddress,
        destinationAddress,
        startDate: _sd,
        endDate: _ed,
        pickupDate: _pd,
        returnDate: _rd,
        recurringStartDate: _rsd,
        recurringEndDate: _red,
        ...restOfTripData
      } = tripData;

      const trip = await Trip.create({
        passengerId: passenger._id,
        pickupLocation: { address: pickupAddress },
        dropoffLocation: { address: destinationAddress },
        fare: fare,
        quotedFare: fare,
        quotedAt: new Date(),
        status: "ACCEPTED",
        acceptedAt: new Date(),
        scheduledTime,
        startDate: sDate,
        endDate: eDate,
        pickupDate: sDate || tripData.pickupDate,
        returnDate: eDate || tripData.returnDate,
        recurringStartDate: sDate || tripData.recurringStartDate,
        recurringEndDate: eDate || tripData.recurringEndDate,
        requestSource: "ADMIN",
        ...restOfTripData,
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

  async getTrips(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 10));
      const skip = (page - 1) * limit;

      const { status, type, search, tab } = req.query;
      const baseFilter: Record<string, unknown> = {};

      let sortLogic: any = { scheduledTime: -1, createdAt: -1 };

      if (type === "requests" || type === "master") {
        baseFilter.parentRequestId = { $exists: false };
      } else if (type === "trips" || type === "child") {
        const parentIdsWithChildren = await Trip.find({ parentRequestId: { $exists: true, $ne: null } }).distinct("parentRequestId");
        if (parentIdsWithChildren.length > 0) {
          baseFilter._id = { $nin: parentIdsWithChildren };
        }
      } else if (type === "live") {
        baseFilter.status = "IN_PROGRESS";
        sortLogic = { inProgressAt: -1, updatedAt: -1, createdAt: -1 };
      }

      // Generate summary based on base filter
      const summaryPipeline = [
        { $match: baseFilter },
        { $group: { _id: "$status", count: { $sum: 1 } } }
      ];
      const summaryData = await Trip.aggregate(summaryPipeline);
      
      let onboardNow = 0;
      let completedCount = 0;
      let totalSummaryTrips = 0;
      
      summaryData.forEach(item => {
        totalSummaryTrips += item.count;
        if (item._id === "IN_PROGRESS") onboardNow += item.count;
        else if (item._id === "COMPLETED") completedCount += item.count;
      });

      // Need driver: active, operational trips that have no assigned driver
      const needDriver = await Trip.countDocuments({
        ...baseFilter,
        status: { $in: ["REQUESTED", "ACCEPTED", "QUOTE_ACCEPTED"] },
        $or: [{ driverId: { $exists: false } }, { driverId: null }],
      });

      const todayStr = getCentralTodayStr();
      const tomorrowStr = getCentralTomorrowStr();

      // Build filters for each tab
      const getTabFilter = (tabName: string): Record<string, unknown> => {
        const f: Record<string, unknown> = { ...baseFilter };
        if (tabName === "completed") {
          f.status = "COMPLETED";
        } else if (tabName === "noShow") {
          f.status = "CANCELLED";
          f.cancellationReason = { $in: ["No Show Up", "NO_SHOW"] };
        } else if (tabName === "cancelled") {
          f.status = "CANCELLED";
          f.cancellationReason = { $nin: ["No Show Up", "NO_SHOW"] };
        } else if (tabName === "missed") {
          f.$or = [
            { status: "MISSED" },
            { 
              status: { $nin: ["COMPLETED", "IN_PROGRESS", "DRIVER_ARRIVING", "DRIVER_ARRIVED", "MISSED", "CANCELLED"] },
              $or: [
                { pickupDate: { $lt: todayStr } },
                {
                  $and: [
                    { $or: [{ pickupDate: { $exists: false } }, { pickupDate: null }, { pickupDate: "" }] },
                    { startDate: { $lt: todayStr } }
                  ]
                }
              ]
            }
          ];
        } else if (tabName === "today") {
          f.status = { $nin: ["COMPLETED", "MISSED", "CANCELLED"] };
          f.$or = [
            { pickupDate: todayStr },
            {
              $and: [
                { $or: [{ pickupDate: { $exists: false } }, { pickupDate: null }, { pickupDate: "" }] },
                { startDate: todayStr }
              ]
            }
          ];
        } else if (tabName === "nextDay" || tabName === "upcoming") {
          f.status = { $nin: ["COMPLETED", "MISSED", "CANCELLED"] };
          f.$or = [
            { pickupDate: tomorrowStr },
            {
              $and: [
                { $or: [{ pickupDate: { $exists: false } }, { pickupDate: null }, { pickupDate: "" }] },
                { startDate: tomorrowStr }
              ]
            }
          ];
        }
        return f;
      };

      // Generate tab counts concurrently
      const [todayCount, nextDayCount, completedTabCount, noShowCount, cancelledCount, missedCount, allCount] = await Promise.all([
        Trip.countDocuments(getTabFilter("today")),
        Trip.countDocuments(getTabFilter("nextDay")),
        Trip.countDocuments(getTabFilter("completed")),
        Trip.countDocuments(getTabFilter("noShow")),
        Trip.countDocuments(getTabFilter("cancelled")),
        Trip.countDocuments(getTabFilter("missed")),
        Trip.countDocuments(getTabFilter("all")),
      ]);

      const activeTab = tab ? (tab as string) : "all";
      const filter: Record<string, unknown> = getTabFilter(activeTab);

      if (type === "live") {
        sortLogic = { inProgressAt: -1, updatedAt: -1, createdAt: -1 };
      } else if (activeTab === "today" || activeTab === "nextDay" || activeTab === "upcoming") {
        sortLogic = { scheduledTime: 1, createdAt: 1 };
      } else {
        sortLogic = { scheduledTime: -1, createdAt: -1 };
      }

      if (status) {
        const statusStr = status as string;
        if (statusStr === "NO_SHOW") {
          filter.status = "CANCELLED";
          filter.cancellationReason = { $in: ["No Show Up", "NO_SHOW"] };
        } else if (statusStr === "CANCELLED") {
          filter.status = "CANCELLED";
          filter.cancellationReason = { $nin: ["No Show Up", "NO_SHOW"] };
        } else if (statusStr === "NEED_DRIVER") {
          filter.status = { $in: ["REQUESTED", "ACCEPTED", "QUOTE_ACCEPTED"] };
          filter.$and = [
            ...(Array.isArray(filter.$and) ? (filter.$and as any[]) : []),
            { $or: [{ driverId: { $exists: false } }, { driverId: null }] },
          ];
        } else if (statusStr.toLowerCase() === "scheduled") {
          filter.status = { $in: ["ACCEPTED", "DRIVER_ARRIVING", "DRIVER_ARRIVED"] };
          filter.driverId = { $exists: true, $ne: null };
        } else if (statusStr.includes(",")) {
          filter.status = { $in: statusStr.split(",") };
        } else {
          filter.status = statusStr;
        }
      }

      if (search) {
        const searchStr = search as string;
        const searchRegex = { $regex: searchStr, $options: "i" };
        
        const userMatches = await mongoose.model("User").find({ name: searchRegex }).distinct("_id");
        
        const orConditions: any[] = [
          { fullName: searchRegex },
          { "pickupLocation.address": searchRegex },
          { "dropoffLocation.address": searchRegex },
          { streetAddress: searchRegex },
          { destinationAddress: searchRegex },
          { $expr: { $regexMatch: { input: { $toString: "$_id" }, regex: searchStr, options: "i" } } }
        ];

        if (userMatches.length > 0) {
          orConditions.push({ passengerId: { $in: userMatches } });
          orConditions.push({ driverId: { $in: userMatches } });
        }
        
        filter.$or = orConditions;
      }

      const now = new Date();
      let trips = await Trip.aggregate([
        { $match: filter },
        { $sort: sortLogic },
        { $skip: skip },
        { $limit: limit }
      ]);
      
      trips = await Trip.populate(trips, [
        { path: "passengerId", select: "name email phone avatarUrl" },
        { path: "driverId", select: "name email phone avatarUrl" }
      ]);

      const total = await Trip.countDocuments(filter);

      res.status(200).json({
        success: true,
        data: {
          trips,
          counts: {
            today: todayCount,
            nextDay: nextDayCount,
            upcoming: nextDayCount,
            completed: completedTabCount,
            noShow: noShowCount,
            cancelled: cancelledCount,
            missed: missedCount,
            all: allCount,
          },
          summary: {
            totalTrips: totalSummaryTrips,
            onboardNow,
            needDriver,
            completedCount,
            tabCounts: {
              today: todayCount,
              nextDay: nextDayCount,
              completed: completedTabCount,
              noShow: noShowCount,
              cancelled: cancelledCount,
              missed: missedCount,
              all: allCount,
            },
          },
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 1,
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

      // Check if trip is completed
      if (trip.status === "COMPLETED") {
        res.status(400).json({
          success: false,
          error: {
            code: "TRIP_COMPLETED",
            message: "Cannot assign or reassign a driver to a completed trip.",
          },
        });
        return;
      }

      // Only allow assigning or reassigning driver to scheduled trips
      const allowedScheduledStatuses = [
        "REQUESTED",
        "QUOTE_ACCEPTED",
        "ACCEPTED",
        "DRIVER_ARRIVING",
        "DRIVER_ARRIVED",
      ];
      if (!allowedScheduledStatuses.includes(trip.status)) {
        res.status(400).json({
          success: false,
          error: {
            code: "TRIP_NOT_SCHEDULED",
            message: `Cannot assign or reassign a driver to a trip with status '${trip.status}'. Only scheduled trips can have drivers assigned or reassigned.`,
          },
        });
        return;
      }

      const rawDriverId = parsed.data.driverId?.trim();
      const now = new Date();
      const previousDriverId = trip.driverId;

      if (rawDriverId) {
        const driver = await User.findOne({ _id: rawDriverId, role: "DRIVER", accountStatus: "ACTIVE" });
        if (!driver) {
          res.status(400).json({ success: false, error: { code: "INVALID_DRIVER", message: "Driver not found or not active" } });
          return;
        }

        trip.driverId = driver._id;
        if (!trip.assignedAt) trip.assignedAt = now;
        if (trip.status === "REQUESTED" || trip.status === "QUOTE_ACCEPTED") {
          trip.status = "ACCEPTED";
          if (!trip.acceptedAt) trip.acceptedAt = now;
        }
        await trip.save();

        const driverOnShift = await DriverShift.exists({
          driverId: driver._id,
          status: "IN_PROGRESS",
        });

        if (driverOnShift) {
          await DriverProfile.findOneAndUpdate(
            { userId: driver._id },
            { availabilityStatus: "ASSIGNED" }
          );
        }

        if (previousDriverId && previousDriverId.toString() !== driver._id.toString()) {
          const otherActiveTrips = await Trip.countDocuments({
            driverId: previousDriverId,
            status: { $in: ["ACCEPTED", "DRIVER_ARRIVING", "DRIVER_ARRIVED", "IN_PROGRESS"] },
            _id: { $ne: trip._id },
          });
          if (otherActiveTrips === 0) {
            const prevOnShift = await DriverShift.exists({
              driverId: previousDriverId,
              status: "IN_PROGRESS",
            });
            await DriverProfile.findOneAndUpdate(
              { userId: previousDriverId },
              { availabilityStatus: prevOnShift ? "ONLINE" : "OFFLINE" }
            );
          }
        }
      } else {
        // Unassign driver from this trip
        trip.driverId = undefined;
        await trip.save();

        if (previousDriverId) {
          const otherActiveTrips = await Trip.countDocuments({
            driverId: previousDriverId,
            status: { $in: ["ACCEPTED", "DRIVER_ARRIVING", "DRIVER_ARRIVED", "IN_PROGRESS"] },
            _id: { $ne: trip._id },
          });
          if (otherActiveTrips === 0) {
            const prevOnShift = await DriverShift.exists({
              driverId: previousDriverId,
              status: "IN_PROGRESS",
            });
            await DriverProfile.findOneAndUpdate(
              { userId: previousDriverId },
              { availabilityStatus: prevOnShift ? "ONLINE" : "OFFLINE" }
            );
          }
        }
      }

      await AuditLog.create({
        actor: new mongoose.Types.ObjectId(req.user!.userId),
        actorRole: req.user!.role,
        action: "ADMIN_ASSIGNED_DRIVER",
        resourceType: "Trip",
        resourceId: trip._id.toString(),
        details: { driverId: rawDriverId || null, tripId: trip._id },
        requestId: req.requestId,
      });

      const populatedTrip = await Trip.findById(trip._id)
        .populate("passengerId", "name email phone avatarUrl")
        .populate("driverId", "name email phone avatarUrl")
        .lean();

      res.status(200).json({
        success: true,
        data: populatedTrip,
      });
    } catch (error) {
      next(error);
    }
  }

  async approveRideRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const trip = await Trip.findById(id);
      if (!trip) {
        res.status(404).json({ success: false, error: { code: "TRIP_NOT_FOUND", message: "Trip not found" } });
        return;
      }

      const previousStatus = trip.status;
      trip.status = "ACCEPTED";
      const now = new Date();
      if (!trip.acceptedAt) trip.acceptedAt = now;
      await trip.save();

      const masterIdObj = trip.parentRequestId || trip._id;
      await Trip.updateMany(
        { $or: [{ _id: masterIdObj }, { parentRequestId: masterIdObj }] },
        { $set: { status: "ACCEPTED", acceptedAt: now } }
      );

      const existingChildCount = await Trip.countDocuments({ parentRequestId: masterIdObj });
      if (existingChildCount === 0) {
        await generateRecurringTripsForMaster(trip);
      }

      await AuditLog.create({
        actor: new mongoose.Types.ObjectId(req.user!.userId),
        actorRole: req.user!.role,
        action: "ADMIN_APPROVED_RIDE_REQUEST",
        resourceType: "Trip",
        resourceId: trip._id.toString(),
        previousState: { status: previousStatus },
        newState: { status: trip.status },
        requestId: req.requestId,
      });

      res.status(200).json({ success: true, data: trip });
    } catch (error) {
      next(error);
    }
  }

  async rejectRideRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
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

      // 1. Check if this trip itself is already in a completed or cancelled state
      if (trip.status === "COMPLETED") {
        res.status(409).json({
          success: false,
          error: { code: "TRIP_ALREADY_COMPLETED", message: "Cannot reject a ride request that has already been completed." },
        });
        return;
      }

      if (trip.status === "CANCELLED" || trip.status === "QUOTE_DENIED") {
        res.status(409).json({
          success: false,
          error: { code: "INVALID_STATE", message: `Ride request is already ${trip.status}` },
        });
        return;
      }

      if (["IN_PROGRESS", "DRIVER_ARRIVING", "DRIVER_ARRIVED"].includes(trip.status)) {
        res.status(409).json({
          success: false,
          error: {
            code: "TRIP_IN_PROGRESS",
            message: "Cannot reject a ride request that is currently in progress. Please cancel the trip if necessary.",
          },
        });
        return;
      }

      const masterIdObj = trip.parentRequestId || trip._id;
      const reason = req.body?.reason || "Rejected by admin";
      const now = new Date();
      const previousStatus = trip.status;

      // 2. Check child legs under this master request (e.g. Outbound and Return legs)
      const childTrips = await Trip.find({
        parentRequestId: masterIdObj,
      });

      const completedLegs = childTrips.filter((t) => t.status === "COMPLETED");
      const activeLegs = childTrips.filter((t) =>
        ["IN_PROGRESS", "DRIVER_ARRIVING", "DRIVER_ARRIVED"].includes(t.status)
      );

      if (activeLegs.length > 0) {
        res.status(409).json({
          success: false,
          error: {
            code: "TRIP_IN_PROGRESS",
            message: "Cannot reject a ride request while a leg is currently in progress. Please cancel the trip if necessary.",
          },
        });
        return;
      }

      if (childTrips.length > 0 && completedLegs.length === childTrips.length) {
        res.status(409).json({
          success: false,
          error: {
            code: "TRIP_ALREADY_COMPLETED",
            message: "Cannot reject a ride request where all legs have already been completed.",
          },
        });
        return;
      }

      // 3. If at least one leg has already been completed (e.g. Outbound completed, Return pending)
      if (completedLegs.length > 0) {
        // Cancel ONLY unstarted/pending child legs (e.g. Return leg). NEVER overwrite COMPLETED legs!
        await Trip.updateMany(
          {
            parentRequestId: masterIdObj,
            status: { $nin: ["COMPLETED", "CANCELLED", "IN_PROGRESS", "DRIVER_ARRIVING", "DRIVER_ARRIVED"] },
          },
          {
            $set: {
              status: "CANCELLED",
              cancelledAt: now,
              cancellationReason: reason,
            },
          }
        );

        // Keep master request marked COMPLETED (since work was fulfilled) with note about cancelled remaining leg
        const masterTrip = trip._id.equals(masterIdObj) ? trip : await Trip.findById(masterIdObj);
        if (masterTrip) {
          masterTrip.status = "COMPLETED";
          masterTrip.completedAt = masterTrip.completedAt || now;
          masterTrip.cancellationReason = `Remaining leg(s) cancelled by admin: ${reason}`;
          await masterTrip.save();
        }
      } else {
        // No legs have been completed: Safe to reject the entire quote/request
        trip.status = "QUOTE_DENIED";
        trip.cancelledAt = now;
        trip.cancellationReason = reason;
        await trip.save();

        await Trip.updateMany(
          {
            $or: [{ _id: masterIdObj }, { parentRequestId: masterIdObj }],
            status: { $nin: ["COMPLETED", "IN_PROGRESS", "DRIVER_ARRIVING", "DRIVER_ARRIVED"] },
          },
          {
            $set: {
              status: "QUOTE_DENIED",
              cancelledAt: now,
              cancellationReason: reason,
            },
          }
        );
      }

      await AuditLog.create({
        actor: new mongoose.Types.ObjectId(req.user!.userId),
        actorRole: req.user!.role,
        action: "ADMIN_REJECTED_RIDE_REQUEST",
        resourceType: "Trip",
        resourceId: trip._id.toString(),
        previousState: { status: previousStatus },
        newState: { status: trip.status },
        requestId: req.requestId,
      });

      res.status(200).json({ success: true, data: trip });
    } catch (error) {
      next(error);
    }
  }

  async updateTrip(req: Request, res: Response, next: NextFunction): Promise<void> {
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

      const previousState = trip.toObject();
      const body = req.body || {};

      if (body.pickupAddress) {
        trip.pickupLocation = { address: body.pickupAddress };
      }
      if (body.destinationAddress) {
        trip.dropoffLocation = { address: body.destinationAddress };
      }
      if (body.passengerAvatarUrl !== undefined) {
        trip.passengerAvatarUrl = body.passengerAvatarUrl;
      }
      if (body.startDate) {
        trip.startDate = body.startDate;
        trip.pickupDate = body.startDate;
        trip.recurringStartDate = body.startDate;
      }
      if (body.endDate) {
        trip.endDate = body.endDate;
        trip.returnDate = body.endDate;
        trip.recurringEndDate = body.endDate;
      }

      Object.assign(trip, body);
      await trip.save();

      if (trip.parentRequestId) {
        // Single child trip updated
      } else {
        // Master request updated: sync child trips for operational fields only if they haven't started
        await Trip.updateMany(
          { parentRequestId: trip._id, status: { $in: ["REQUESTED", "QUOTE_SENT", "QUOTE_COUNTERED", "QUOTE_ACCEPTED", "ACCEPTED"] } },
          {
            fare: trip.fare,
            driverNotes: trip.driverNotes,
            specialInstructions: trip.specialInstructions,
            mobilityOptions: trip.mobilityOptions,
            returnPickupTime: trip.returnPickupTime,
            returnPickupAddress: trip.returnPickupAddress,
            returnDestinationAddress: trip.returnDestinationAddress,
          }
        );
        
        // Always sync passenger identity info to ALL child trips regardless of status
        const passengerFieldsToSync: any = {};
        if (body.passengerAvatarUrl !== undefined) passengerFieldsToSync.passengerAvatarUrl = trip.passengerAvatarUrl;
        if (body.fullName !== undefined) passengerFieldsToSync.fullName = trip.fullName;
        if (body.dateOfBirth !== undefined) passengerFieldsToSync.dateOfBirth = trip.dateOfBirth;
        if (body.phoneNumber !== undefined) passengerFieldsToSync.phoneNumber = trip.phoneNumber;
        if (body.email !== undefined) passengerFieldsToSync.email = trip.email;
        if (body.emergencyContactName !== undefined) passengerFieldsToSync.emergencyContactName = trip.emergencyContactName;
        if (body.emergencyContactPhone !== undefined) passengerFieldsToSync.emergencyContactPhone = trip.emergencyContactPhone;
        if (body.relationship !== undefined) passengerFieldsToSync.relationship = trip.relationship;

        if (Object.keys(passengerFieldsToSync).length > 0) {
          await Trip.updateMany(
            { parentRequestId: trip._id },
            { $set: passengerFieldsToSync }
          );
        }
        await generateRecurringTripsForMaster(trip);
      }

      await AuditLog.create({
        actor: new mongoose.Types.ObjectId(req.user!.userId),
        actorRole: req.user!.role,
        action: "ADMIN_UPDATED_TRIP",
        resourceType: "Trip",
        resourceId: trip._id.toString(),
        previousState,
        newState: trip.toObject(),
        requestId: req.requestId,
      });

      res.status(200).json({ success: true, data: trip });
    } catch (error) {
      next(error);
    }
  }

  async deleteTrip(req: Request, res: Response, next: NextFunction): Promise<void> {
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

      const targetIdObj = new mongoose.Types.ObjectId(id);
      const isCascade = req.query.cascade === "true" || req.query.all === "true";

      if (isCascade) {
        const masterIdObj = trip.parentRequestId ? new mongoose.Types.ObjectId(trip.parentRequestId.toString()) : targetIdObj;
        await Trip.deleteMany({
          $or: [
            { _id: masterIdObj },
            { parentRequestId: masterIdObj },
            { _id: targetIdObj },
          ],
        });
      } else if (trip.parentRequestId) {
        // Individual trip belonging to a ride request: delete ONLY this specific trip
        await Trip.findByIdAndDelete(targetIdObj);
      } else {
        // Master request: delete the request and its generated child trips
        await Trip.deleteMany({
          $or: [
            { _id: targetIdObj },
            { parentRequestId: targetIdObj },
          ],
        });
      }

      await AuditLog.create({
        actor: new mongoose.Types.ObjectId(req.user!.userId),
        actorRole: req.user!.role,
        action: "ADMIN_DELETED_TRIP",
        resourceType: "Trip",
        resourceId: id,
        previousState: { status: trip.status, fare: trip.fare, fullName: trip.fullName },
        requestId: req.requestId,
      });

      res.status(200).json({
        success: true,
        message: isCascade || !trip.parentRequestId
          ? "Trip and all associated recurring instances deleted successfully"
          : "Trip deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  async regenerateTrips(req: Request, res: Response, next: NextFunction): Promise<void> {
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

      const result = await generateRecurringTripsForMaster(trip);
      const updatedTrip = await Trip.findById(id);

      const count = await Trip.countDocuments({ parentRequestId: trip._id });

      let message = `Successfully regenerated ${count} trip leg(s) for this request`;
      if (result?.isMasterExecutable) {
        message = `Successfully updated one-way trip schedule for ${updatedTrip?.pickupDate || updatedTrip?.startDate || "scheduled date"}`;
      }

      await AuditLog.create({
        actor: new mongoose.Types.ObjectId(req.user!.userId),
        actorRole: req.user!.role,
        action: "ADMIN_REGENERATED_TRIPS",
        resourceType: "Trip",
        resourceId: id,
        requestId: req.requestId,
      });

      res.status(200).json({
        success: true,
        message,
        count,
        data: updatedTrip || trip,
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
        .populate("passengerId", "name email phone avatarUrl")
        .populate("driverId", "name email phone avatarUrl")
        .lean();

      if (!trip) {
        res.status(404).json({ success: false, error: { code: "TRIP_NOT_FOUND", message: "Trip not found" } });
        return;
      }

      // If viewing a child leg that was generated without signature, inherit from parent request
      if (trip.parentRequestId && (!trip.signature || !trip.printedName)) {
        const parent = await Trip.findById(trip.parentRequestId).lean();
        if (parent) {
          trip.signature = trip.signature || parent.signature;
          trip.signatureDate = trip.signatureDate || parent.signatureDate;
          trip.printedName = trip.printedName || parent.printedName;
          trip.relationshipToPassenger = trip.relationshipToPassenger || parent.relationshipToPassenger;
          if (trip.consentPhoto === undefined) trip.consentPhoto = parent.consentPhoto;
          if (trip.consentTransport === undefined) trip.consentTransport = parent.consentTransport;
          if (trip.consentEsignature === undefined) trip.consentEsignature = parent.consentEsignature;
          if (trip.consentHipaa === undefined) trip.consentHipaa = parent.consentHipaa;
          if (!trip.guardianName) trip.guardianName = parent.guardianName;
          if (!trip.guardianPhone) trip.guardianPhone = parent.guardianPhone;
          if (!trip.guardianEmail) trip.guardianEmail = parent.guardianEmail;
          if (!trip.caseManagerName) trip.caseManagerName = parent.caseManagerName;
          if (!trip.caseManagerPhone) trip.caseManagerPhone = parent.caseManagerPhone;
          if (!trip.caseManagerEmail) trip.caseManagerEmail = parent.caseManagerEmail;
        }
      }

      // Fetch child legs if this is a master request or has child legs
      const childTrips = await Trip.find({ parentRequestId: trip._id })
        .populate("driverId", "name email phone avatarUrl")
        .sort({ scheduledTime: 1, pickupDate: 1 })
        .lean();

      let driverProfile = null;
      if (trip.driverId) {
        const driverObjId = (trip.driverId as any)._id || trip.driverId;
        driverProfile = await DriverProfile.findOne({ userId: driverObjId })
          .select("vehicle availabilityStatus")
          .lean();
      }

      const auditLogs = await AuditLog.find({ resourceId: id })
        .sort({ timestamp: -1 })
        .lean();

      const completedChildTrips = childTrips.filter((c: any) => c.status === "COMPLETED");
      const completedChildCount = completedChildTrips.length;
      const isRoundTrip = trip.tripType === "round-trip" || trip.tripType === "round_trip" || (trip as any).isRoundTrip === true;
      const completedTripsCount = childTrips.length > 0
        ? completedChildCount
        : (trip.status === "COMPLETED" ? (isRoundTrip ? 2 : 1) : 0);

      const effectiveFare = typeof trip.fare === "number" && !isNaN(trip.fare) && trip.fare > 0
        ? trip.fare
        : (typeof trip.quotedFare === "number" && !isNaN(trip.quotedFare) && trip.quotedFare > 0 ? trip.quotedFare : 0);

      const billableFare = childTrips.length > 0 && completedChildCount > 0
        ? completedChildTrips.reduce((sum: number, c: any) => sum + (typeof c.fare === "number" && !isNaN(c.fare) && c.fare > 0 ? c.fare : (typeof c.quotedFare === "number" && !isNaN(c.quotedFare) && c.quotedFare > 0 ? c.quotedFare : effectiveFare)), 0)
        : completedTripsCount * effectiveFare;

      res.status(200).json({
        success: true,
        data: {
          ...trip,
          childTrips,
          driverProfile,
          auditLogs,
          completedTripsCount,
          billableFare,
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

      const hasCompletedChild = await Trip.exists({
        parentRequestId: trip._id,
        status: "COMPLETED",
      });

      trip.cancelledAt = new Date();
      trip.cancellationReason = req.body?.reason || "Cancelled by admin";
      if (hasCompletedChild) {
        trip.status = "COMPLETED";
        trip.completedAt = trip.completedAt || trip.cancelledAt;
        trip.cancellationReason = `Remaining leg(s) cancelled by admin: ${trip.cancellationReason}`;
      } else {
        trip.status = "CANCELLED";
      }
      await trip.save();

      // Cancel any incomplete child legs if this is a master request
      await Trip.updateMany(
        { parentRequestId: trip._id, status: { $nin: ["COMPLETED", "CANCELLED"] } },
        { $set: { status: "CANCELLED", cancelledAt: trip.cancelledAt, cancellationReason: trip.cancellationReason } }
      );

      // If cancelling an individual child leg, update master request if all legs finished
      if (trip.parentRequestId) {
        const remainingIncomplete = await Trip.countDocuments({
          parentRequestId: trip.parentRequestId,
          status: { $nin: ["COMPLETED", "CANCELLED"] },
        });
        if (remainingIncomplete === 0) {
          const anyCompleted = await Trip.exists({
            parentRequestId: trip.parentRequestId,
            status: "COMPLETED",
          });
          await Trip.findByIdAndUpdate(trip.parentRequestId, {
            status: anyCompleted ? "COMPLETED" : "CANCELLED",
            completedAt: anyCompleted ? new Date() : undefined,
            cancelledAt: anyCompleted ? undefined : new Date(),
          });
        }
      }

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

      // Determine the master trip ID (if this is a child leg, resolve the parent)
      const masterId = trip.parentRequestId ? trip.parentRequestId : trip._id;
      const masterTrip = trip.parentRequestId ? await Trip.findById(masterId) : trip;

      if (!masterTrip) {
        res.status(404).json({ success: false, error: { code: "TRIP_NOT_FOUND", message: "Master trip not found" } });
        return;
      }

      // Prohibit quote updates only if the master request is completely cancelled
      if (masterTrip.status === "CANCELLED") {
        res.status(409).json({
          success: false,
          error: { code: "INVALID_TRIP_STATE", message: "Cannot send or update a quote for a cancelled ride request" },
        });
        return;
      }

      const previousStatus = masterTrip.status;
      const previousQuotedFare = masterTrip.quotedFare;

      // Find all child trips under this master request
      const childTrips = await Trip.find({ parentRequestId: masterId }).select("_id status quotedFare fare");
      const totalChildTrips = childTrips.length;
      const completedCount = childTrips.filter((c) => c.status === "COMPLETED").length;

      // If it's a standalone single trip (no child trips) and it's already completed
      if (totalChildTrips === 0 && masterTrip.status === "COMPLETED") {
        res.status(409).json({
          success: false,
          error: {
            code: "TRIP_ALREADY_COMPLETED",
            message: "Cannot update quotation because this single trip has already been completed",
          },
        });
        return;
      }

      // Update the master trip's quote information
      masterTrip.quotedFare = parsed.data.quotedFare;
      masterTrip.quotedAt = new Date();
      if (parsed.data.quoteNote !== undefined) {
        masterTrip.quoteNote = parsed.data.quoteNote;
      }
      if (parsed.data.quoteBreakdown !== undefined) {
        masterTrip.quoteBreakdown = parsed.data.quoteBreakdown;
      }

      // Only transition to QUOTE_SENT if previous state was initial negotiation
      if (masterTrip.status === "REQUESTED" || masterTrip.status === "QUOTE_COUNTERED") {
        masterTrip.status = "QUOTE_SENT";
      }

      // If master trip was already accepted and has no child trips, sync fare too
      if (totalChildTrips === 0 && (masterTrip.status === "ACCEPTED" || masterTrip.status === "QUOTE_ACCEPTED")) {
        masterTrip.fare = parsed.data.quotedFare;
      }

      await masterTrip.save();

      // Update future child legs ONLY (exclude COMPLETED and CANCELLED trips)
      let updatedFutureCount = 0;
      if (totalChildTrips > 0) {
        const childUpdateDoc: any = {
          quotedFare: parsed.data.quotedFare,
          quotedAt: new Date(),
        };
        if (parsed.data.quoteNote !== undefined) {
          childUpdateDoc.quoteNote = parsed.data.quoteNote;
        }
        if (parsed.data.quoteBreakdown !== undefined) {
          childUpdateDoc.quoteBreakdown = parsed.data.quoteBreakdown;
        }
        // If master trip is QUOTE_SENT, propagate QUOTE_SENT to future legs
        if (masterTrip.status === "QUOTE_SENT") {
          childUpdateDoc.status = "QUOTE_SENT";
        }
        // If master trip is already operational (e.g. ACCEPTED, QUOTE_ACCEPTED, IN_PROGRESS),
        // sync the active fare for future trips so billing and driver assignment reflect the new quote
        if (["ACCEPTED", "QUOTE_ACCEPTED", "IN_PROGRESS", "DRIVER_ARRIVING", "DRIVER_ARRIVED"].includes(masterTrip.status)) {
          childUpdateDoc.fare = parsed.data.quotedFare;
        }

        const updateResult = await Trip.updateMany(
          {
            parentRequestId: masterId,
            status: { $nin: ["COMPLETED", "CANCELLED"] },
          },
          { $set: childUpdateDoc }
        );
        updatedFutureCount = updateResult.modifiedCount;
      }

      await AuditLog.create({
        actor: new mongoose.Types.ObjectId(req.user!.userId),
        actorRole: req.user!.role,
        action: previousQuotedFare ? "ADMIN_UPDATED_QUOTE" : "ADMIN_SENT_QUOTE",
        resourceType: "Trip",
        resourceId: masterTrip._id.toString(),
        previousState: { status: previousStatus, quotedFare: previousQuotedFare },
        newState: {
          status: masterTrip.status,
          quotedFare: masterTrip.quotedFare,
          updatedFutureTrips: updatedFutureCount,
          completedTripsRetained: completedCount,
        },
        requestId: req.requestId,
      });

      res.status(200).json({
        success: true,
        data: {
          id: masterTrip._id.toString(),
          status: masterTrip.status,
          quotedFare: masterTrip.quotedFare,
          quotedAt: masterTrip.quotedAt,
          quoteNote: masterTrip.quoteNote,
          quoteBreakdown: masterTrip.quoteBreakdown,
          updatedFutureTripsCount: updatedFutureCount,
          completedTripsCount: completedCount,
          totalChildTrips,
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
}

export const adminTripController = new AdminTripController();
