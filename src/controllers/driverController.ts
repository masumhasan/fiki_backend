import mongoose from "mongoose";
import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { DriverAvailabilityStatus, DriverProfile } from "../models/DriverProfile.js";
import { DriverShift } from "../models/DriverShift.js";
import { Trip, TripStatus } from "../models/Trip.js";
import { User } from "../models/User.js";



const availabilitySchema = z.object({
  availabilityStatus: z.enum(["OFFLINE", "ONLINE", "UNAVAILABLE"], {
    errorMap: () => ({ message: "Invalid availability status. Must be OFFLINE, ONLINE, or UNAVAILABLE." }),
  }),
});

const locationSchema = z.object({
  latitude: z
    .number({ required_error: "Latitude is required" })
    .min(-90, "Latitude must be >= -90")
    .max(90, "Latitude must be <= 90"),
  longitude: z
    .number({ required_error: "Longitude is required" })
    .min(-180, "Longitude must be >= -180")
    .max(180, "Longitude must be <= 180"),
});

export class DriverController {
  async getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Not authenticated" } });
        return;
      }

      const user = await User.findById(req.user.userId).lean();
      if (!user) {
        res.status(404).json({ success: false, error: { code: "USER_NOT_FOUND", message: "Driver account not found" } });
        return;
      }

      const profile = await DriverProfile.findOne({ userId: req.user.userId }).lean();

      res.status(200).json({
        success: true,
        data: {
          user: {
            id: user._id.toString(),
            email: user.email,
            name: user.name,
            phone: user.phone,
            role: user.role,
            accountStatus: user.accountStatus,
          },
          profile: profile
            ? {
                licenseNumber: profile.licenseNumber,
                vehicle: profile.vehicle,
                approvalStatus: profile.approvalStatus,
                availabilityStatus: profile.availabilityStatus,
                currentLocation: profile.currentLocation,
                rating: profile.rating,
                completedTripsCount: profile.completedTripsCount,
              }
            : null,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Not authenticated" } });
        return;
      }

      const parsed = availabilitySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({
          success: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid availability status",
            details: parsed.error.flatten().fieldErrors,
          },
        });
        return;
      }

      const { availabilityStatus } = parsed.data;

      const profile = await DriverProfile.findOneAndUpdate(
        { userId: req.user.userId },
        { availabilityStatus: availabilityStatus as DriverAvailabilityStatus },
        { new: true, upsert: true }
      ).lean();

      res.status(200).json({
        success: true,
        data: {
          availabilityStatus: profile.availabilityStatus,
          updatedAt: profile.updatedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateLocation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Not authenticated" } });
        return;
      }

      const parsed = locationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({
          success: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid location coordinates",
            details: parsed.error.flatten().fieldErrors,
          },
        });
        return;
      }

      const { latitude, longitude } = parsed.data;

      const profile = await DriverProfile.findOneAndUpdate(
        { userId: req.user.userId },
        {
          currentLocation: {
            type: "Point",
            coordinates: [longitude, latitude],
            updatedAt: new Date(),
          },
        },
        { new: true, upsert: true }
      ).lean();

      res.status(200).json({
        success: true,
        data: {
          currentLocation: profile.currentLocation,
          updatedAt: profile.updatedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async getTrips(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Not authenticated" } });
        return;
      }

      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
      const skip = (page - 1) * limit;

      const { status } = req.query;
      const filter: Record<string, unknown> = { driverId: req.user.userId };
      if (status) filter.status = status;

      const trips = await Trip.find(filter)
        .populate("passengerId", "name email phone")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      const total = await Trip.countDocuments(filter);

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

  async updateTripStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Not authenticated" } });
        return;
      }

      const id = req.params.id as string;
      const { status, receiverSignature, receiverName, receiverRelationship } = req.body;

      const validStatuses: TripStatus[] = ["DRIVER_ARRIVING", "DRIVER_ARRIVED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
      if (!status || !validStatuses.includes(status)) {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_STATUS", message: `Status must be one of: ${validStatuses.join(", ")}` },
        });
        return;
      }

      const trip = await Trip.findOne({ _id: id, driverId: req.user.userId });
      if (!trip) {
        res.status(404).json({ success: false, error: { code: "TRIP_NOT_FOUND", message: "Trip not found or not assigned to driver" } });
        return;
      }

      // Enforce Hand to Hand drop-off signature requirement if trip requires Hand to Hand
      const isHandToHand = Array.isArray(trip.mobilityOptions) &&
        trip.mobilityOptions.some((opt: string) => opt.toLowerCase().includes("hand"));

      if (status === "COMPLETED" && isHandToHand) {
        const sig = receiverSignature || trip.receiverSignature;
        if (!sig) {
          res.status(400).json({
            success: false,
            error: {
              code: "RECEIVER_SIGNATURE_REQUIRED",
              message: "Hand to Hand drop-off requires the receiver's digital signature before completing the trip.",
            },
          });
          return;
        }
      }

      // Enforce that driver has an active shift started today before performing trip status updates
      const todayStr = new Date().toISOString().split("T")[0];
      const activeShift = await DriverShift.findOne({
        driverId: req.user.userId,
        shiftDate: todayStr,
        status: "IN_PROGRESS",
      });

      if (!activeShift) {
        res.status(400).json({
          success: false,
          error: {
            code: "SHIFT_NOT_STARTED",
            message: "You must start your shift from the 'My Schedule & Attendance' page before performing trip actions or starting a pickup.",
          },
        });
        return;
      }


      // Enforce valid state machine transitions
      const ALLOWED_TRANSITIONS: Record<TripStatus, TripStatus[]> = {
        REQUESTED: ["ACCEPTED", "CANCELLED"],
        QUOTE_SENT: ["CANCELLED"],
        QUOTE_ACCEPTED: ["ACCEPTED", "CANCELLED"],
        QUOTE_DENIED: [],
        QUOTE_COUNTERED: ["CANCELLED"],
        ACCEPTED: ["DRIVER_ARRIVING", "CANCELLED"],
        DRIVER_ARRIVING: ["DRIVER_ARRIVED", "CANCELLED"],
        DRIVER_ARRIVED: ["IN_PROGRESS", "CANCELLED"],
        IN_PROGRESS: ["COMPLETED", "CANCELLED"],
        COMPLETED: [],
        CANCELLED: [],
      };

      const allowed = ALLOWED_TRANSITIONS[trip.status] || [];
      if (!allowed.includes(status)) {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_STATE_TRANSITION",
            message: `Cannot transition trip from '${trip.status}' to '${status}'`,
          },
        });
        return;
      }

      trip.status = status;
      const statusNow = new Date();
      if (status === "DRIVER_ARRIVING") {
        trip.arrivingAt = statusNow;
      } else if (status === "DRIVER_ARRIVED") {
        trip.arrivedAt = statusNow;
      } else if (status === "IN_PROGRESS") {
        trip.inProgressAt = statusNow;
        if (!trip.startedAt) trip.startedAt = statusNow;
      } else if (status === "COMPLETED") {
        if (!trip.completedAt) trip.completedAt = statusNow;
        if (receiverSignature) trip.receiverSignature = receiverSignature;
        if (receiverName) trip.receiverName = receiverName;
        if (receiverRelationship) trip.receiverRelationship = receiverRelationship;
        if (receiverSignature && !trip.receiverSignedAt) trip.receiverSignedAt = statusNow;
      } else if (status === "CANCELLED") {
        if (!trip.cancelledAt) trip.cancelledAt = statusNow;
      }

      await trip.save();

      // If completed or cancelled, free up the driver availability
      if (status === "COMPLETED" || status === "CANCELLED") {
        const updateObj: Record<string, unknown> = { availabilityStatus: "ONLINE" };
        if (status === "COMPLETED") {
          updateObj.$inc = { completedTripsCount: 1 };
        }
        await DriverProfile.findOneAndUpdate({ userId: req.user.userId }, updateObj);
      }

      res.status(200).json({
        success: true,
        data: trip,
      });
    } catch (error) {
      next(error);
    }
  }

  async getTripById(req: Request, res: Response, next: NextFunction): Promise<void> {
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

      const trip = await Trip.findOne({ _id: id, driverId: req.user.userId })
        .populate("passengerId", "name email phone")
        .lean();

      if (!trip) {
        res.status(404).json({ success: false, error: { code: "TRIP_NOT_FOUND", message: "Trip not found or not assigned to driver" } });
        return;
      }

      const profile = await DriverProfile.findOne({ userId: req.user.userId })
        .select("vehicle rating availabilityStatus")
        .lean();

      res.status(200).json({
        success: true,
        data: {
          ...trip,
          driverProfile: profile,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateTripNotes(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Not authenticated" } });
        return;
      }

      const id = req.params.id as string;
      const { driverNotes } = req.body;

      const trip = await Trip.findOne({ _id: id, driverId: req.user.userId });
      if (!trip) {
        res.status(404).json({ success: false, error: { code: "TRIP_NOT_FOUND", message: "Trip not found or not assigned to driver" } });
        return;
      }

      trip.driverShiftNotes = driverNotes || "";
      await trip.save();

      res.status(200).json({ success: true, data: trip });
    } catch (error) {
      next(error);
    }
  }

  async getEarnings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Not authenticated" } });
        return;
      }

      const driverId = req.user.userId;
      const profile = await DriverProfile.findOne({ userId: driverId }).lean();
      
      const hourlyRate = profile?.hourlyRate ?? 14.0;
      const approvedHours = profile?.approvedHours ?? 80.0;
      const tripBonusPerRide = profile?.tripBonusRate ?? 3.0;
      const payrollStatus = profile?.payrollStatus || "Approved";

      // 14-day current pay period calculation window
      const now = new Date();
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

      // Fetch completed trips in current pay period
      const completedTrips = await Trip.find({
        driverId,
        status: "COMPLETED",
        createdAt: { $gte: fourteenDaysAgo }
      }).sort({ createdAt: -1 }).lean();

      const completedTripsCount = completedTrips.length;
      const tripBonus = completedTripsCount * tripBonusPerRide;
      const regularWages = hourlyRate * approvedHours;
      const grossEarnings = regularWages + tripBonus;

      // Date range formatting
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const payPeriodStartStr = `${monthNames[fourteenDaysAgo.getMonth()]} ${fourteenDaysAgo.getDate()}`;
      const payPeriodEndStr = `${monthNames[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
      const payPeriodRange = `${payPeriodStartStr} – ${payPeriodEndStr}`;

      const expectedPayDateObj = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);
      const expectedPayDate = `${monthNames[expectedPayDateObj.getMonth()]} ${expectedPayDateObj.getDate()}, ${expectedPayDateObj.getFullYear()}`;

      // Map rides for ride history
      const rideHistory = completedTrips.map((t: any) => {
        const tripId = `TRP-${t._id.toString().substring(t._id.toString().length - 4).toUpperCase()}`;
        const passengerName = t.fullName || (t.passengerId as any)?.name || "Passenger";
        const pickup = t.pickupLocation?.address || "Pickup";
        const dropoff = t.dropoffLocation?.address || t.returnDestinationAddress || "Destination";
        const d = new Date(t.createdAt);
        const dateStr = `${monthNames[d.getMonth()]} ${d.getDate()}`;
        return {
          date: dateStr,
          tripId,
          passenger: passengerName,
          type: t.mobilityOptions?.includes("stretcher") ? "Stretcher" : t.mobilityOptions?.includes("wheelchair") ? "Wheelchair" : "Standard",
          pickup,
          destination: dropoff,
          status: "Completed",
          bonus: `+$${tripBonusPerRide.toFixed(2)}`,
        };
      });

      res.status(200).json({
        success: true,
        data: {
          hourlyRate,
          approvedHours,
          completedTripsCount,
          tripBonusPerRide,
          tripBonusRate: tripBonusPerRide,
          tripBonus,
          regularWages,
          grossEarnings,
          totalEarnings: grossEarnings,
          totalRides: completedTripsCount,
          payrollStatus,
          payPeriodRange,
          expectedPayDate,
          rideHistory,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async getTodayShift(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Not authenticated" } });
        return;
      }

      const todayStr = new Date().toISOString().split("T")[0];

      // First check if there is an in-progress shift
      let shift = await DriverShift.findOne({
        driverId: req.user.userId,
        status: "IN_PROGRESS",
      }).sort({ startedAt: -1 }).lean();

      // If no in-progress shift, find latest shift created today
      if (!shift) {
        shift = await DriverShift.findOne({
          driverId: req.user.userId,
          shiftDate: todayStr,
        }).sort({ createdAt: -1 }).lean();
      }

      res.status(200).json({
        success: true,
        data: { shift: shift || null },
      });
    } catch (error) {
      next(error);
    }
  }

  async getScheduleSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Not authenticated" } });
        return;
      }

      const driverId = req.user.userId;
      const now = new Date();
      const todayStr = now.toISOString().split("T")[0];

      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(todayStart);
      todayEnd.setDate(todayEnd.getDate() + 1);

      // Start of current week (Monday)
      const currentDayOfWeek = now.getDay();
      const distanceToMon = (currentDayOfWeek + 6) % 7;
      const startOfWeek = new Date(todayStart);
      startOfWeek.setDate(startOfWeek.getDate() - distanceToMon);

      // Fetch today's trips, shift, week shifts, and driver profile concurrently
      const [todayTrips, todayShift, weekShifts, driverProfile] = await Promise.all([
        Trip.find({
          driverId,
          $or: [
            { pickupDate: todayStr },
            { createdAt: { $gte: todayStart, $lt: todayEnd } }
          ]
        }).lean(),

        DriverShift.findOne({
          driverId,
          $or: [
            { status: "IN_PROGRESS" },
            { shiftDate: todayStr }
          ]
        }).sort({ createdAt: -1 }).lean(),

        DriverShift.find({
          driverId,
          createdAt: { $gte: startOfWeek }
        }).lean(),

        DriverProfile.findOne({ userId: driverId }).lean()
      ]);

      // Schedule config from DriverProfile
      const weeklyScheduleConfig = driverProfile?.weeklySchedule || [];
      const scheduleMapByDay = new Map(weeklyScheduleConfig.map((s: any) => [s.day, s]));
      const dayAbbrKeys = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

      const getScheduleConfigForDate = (dateObj: Date) => {
        const key = dayAbbrKeys[dateObj.getDay()];
        const cfg = scheduleMapByDay.get(key) as any;
        if (cfg) {
          const isWorking = cfg.working !== false;
          const startTime = cfg.startTime || "08:00 AM";
          const endTime = cfg.endTime || "04:00 PM";
          const hoursText = isWorking ? `${startTime} – ${endTime}` : "Day Off";
          return { isWorking, startTime, endTime, hoursText };
        }
        return { isWorking: true, startTime: "08:00 AM", endTime: "04:00 PM", hoursText: "08:00 AM – 04:00 PM" };
      };

      const todayConfig = getScheduleConfigForDate(now);
      const todaySchedule = {
        startTime: todayConfig.startTime,
        endTime: todayConfig.endTime,
        hours: todayConfig.isWorking ? "8 hours" : "Day Off",
      };

      // 1. Today's Trip Summary
      const totalTripsCount = todayTrips.length;
      const completedTripsCount = todayTrips.filter((t: any) => t.status === "COMPLETED").length;
      const inProgressTripsCount = todayTrips.filter((t: any) => ["DRIVER_ARRIVING", "DRIVER_ARRIVED", "IN_PROGRESS"].includes(t.status)).length;
      const remainingTripsCount = Math.max(0, totalTripsCount - completedTripsCount - inProgressTripsCount);

      const tripSummary = {
        totalTrips: totalTripsCount,
        completed: completedTripsCount,
        inProgress: inProgressTripsCount,
        remaining: remainingTripsCount,
      };

      // 2. Upcoming Schedule (Next 5 Days starting tomorrow)
      const dayAbbrs = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
      const upcomingSchedule = [];
      for (let i = 1; i <= 5; i++) {
        const d = new Date(todayStart);
        d.setDate(d.getDate() + i);
        const dayCfg = getScheduleConfigForDate(d);
        upcomingSchedule.push({
          day: dayAbbrs[d.getDay()],
          date: String(d.getDate()),
          hours: dayCfg.hoursText,
          status: dayCfg.isWorking ? "Scheduled" : "Day Off",
        });
      }

      // 3. Weekly Schedule (7 Days of Current Week: Mon - Sun)
      const fullDayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const monthShortNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      
      const shiftMap = new Map(weekShifts.map((s: any) => [s.shiftDate, s]));

      const weeklySchedule = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(startOfWeek);
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split("T")[0];
        const dayName = fullDayNames[d.getDay()];
        const formattedDate = `${monthShortNames[d.getMonth()]} ${d.getDate()}`;
        const dayCfg = getScheduleConfigForDate(d);

        const s = shiftMap.get(dateStr) as any;

        let shiftHours = dayCfg.hoursText;
        let totalHours = dayCfg.isWorking ? "8h" : "—";
        let attendance = dayCfg.isWorking ? "Pending" : "Off";
        let approval = "Pending";

        if (s) {
          if (s.startedAt && s.endedAt) {
            const startT = new Date(s.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            const endT = new Date(s.endedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            shiftHours = `${startT} – ${endT}`;
          } else if (s.startedAt) {
            const startT = new Date(s.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            shiftHours = `${startT} – In Progress`;
          }

          if (s.totalHoursText) {
            totalHours = s.totalHoursText;
          } else if (s.status === "IN_PROGRESS" && s.startedAt) {
            const diffMs = Date.now() - new Date(s.startedAt).getTime();
            const mins = Math.max(1, Math.round(diffMs / 60000));
            totalHours = `${Math.floor(mins / 60)}h ${mins % 60}m`;
          }

          if (s.status === "COMPLETED") {
            attendance = "Present";
            approval = "Approved";
          } else if (s.status === "IN_PROGRESS") {
            attendance = "In Progress";
            approval = "Pending";
          }
        } else {
          if (d < todayStart) {
            attendance = dayCfg.isWorking ? "Absent" : "Off";
            approval = "Approved";
            totalHours = "—";
          } else if (d.getTime() === todayStart.getTime()) {
            attendance = todayShift?.status === "IN_PROGRESS" ? "In Progress" : dayCfg.isWorking ? "Pending" : "Off";
            approval = "Pending";
            totalHours = dayCfg.isWorking ? "8h" : "—";
          } else {
            attendance = dayCfg.isWorking ? "Scheduled" : "Off";
            approval = "Pending";
            totalHours = dayCfg.isWorking ? "8h" : "—";
          }
        }

        weeklySchedule.push({
          day: dayName,
          date: formattedDate,
          shiftHours,
          total: totalHours,
          attendance,
          approval,
        });
      }

      res.status(200).json({
        success: true,
        data: {
          todayShift: todayShift || null,
          todaySchedule,
          tripSummary,
          upcomingSchedule,
          weeklySchedule,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async startShift(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Not authenticated" } });
        return;
      }

      const { odometer, fuel = "half", condition = "clear", notes = "" } = req.body;
      const rawOdometer = String(odometer || "").replace(/[^\d.]/g, "");
      const numOdometer = parseFloat(rawOdometer);

      if (isNaN(numOdometer) || numOdometer <= 0) {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_ODOMETER", message: "Valid starting odometer reading is required" },
        });
        return;
      }

      // Check if driver already has an in-progress shift
      const existing = await DriverShift.findOne({
        driverId: req.user.userId,
        status: "IN_PROGRESS",
      });

      if (existing) {
        res.status(400).json({
          success: false,
          error: { code: "SHIFT_IN_PROGRESS", message: "A shift is already currently in progress" },
        });
        return;
      }

      const profile = await DriverProfile.findOne({ userId: req.user.userId }).lean();
      const todayStr = new Date().toISOString().split("T")[0];

      const shift = await DriverShift.create({
        driverId: req.user.userId,
        shiftDate: todayStr,
        status: "IN_PROGRESS",
        startedAt: new Date(),
        startingOdometer: numOdometer,
        startFuel: fuel,
        startCondition: condition,
        startNotes: notes,
        vehicleInfo: profile?.vehicle ? {
          make: profile.vehicle.make,
          model: profile.vehicle.model,
          year: profile.vehicle.year,
          licensePlate: profile.vehicle.licensePlate,
        } : undefined,
      });

      // Mark driver availability as ONLINE
      await DriverProfile.findOneAndUpdate(
        { userId: req.user.userId },
        { availabilityStatus: "ONLINE" }
      );

      res.status(201).json({
        success: true,
        data: shift,
      });
    } catch (error) {
      next(error);
    }
  }

  async endShift(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Not authenticated" } });
        return;
      }

      const { odometer, fuel = "half", condition = "clear", notes = "" } = req.body;
      const rawOdometer = String(odometer || "").replace(/[^\d.]/g, "");
      const numOdometer = parseFloat(rawOdometer);

      if (isNaN(numOdometer) || numOdometer <= 0) {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_ODOMETER", message: "Valid ending odometer reading is required" },
        });
        return;
      }

      const shift = await DriverShift.findOne({
        driverId: req.user.userId,
        status: "IN_PROGRESS",
      });

      if (!shift) {
        res.status(404).json({
          success: false,
          error: { code: "NO_ACTIVE_SHIFT", message: "No active shift found to end" },
        });
        return;
      }

      const endedAt = new Date();
      const diffMs = endedAt.getTime() - shift.startedAt.getTime();
      const totalMinutes = Math.max(1, Math.round(diffMs / 60000));
      const hours = Math.floor(totalMinutes / 60);
      const mins = totalMinutes % 60;
      const totalHoursText = `${hours}h ${mins < 10 ? '0' : ''}${mins}m`;
      const estimatedMiles = Math.max(0, parseFloat((numOdometer - shift.startingOdometer).toFixed(1)));

      shift.status = "COMPLETED";
      shift.endedAt = endedAt;
      shift.endingOdometer = numOdometer;
      shift.estimatedMiles = estimatedMiles;
      shift.totalMinutes = totalMinutes;
      shift.totalHoursText = totalHoursText;
      shift.endFuel = fuel;
      shift.endCondition = condition;
      shift.endNotes = notes;

      await shift.save();

      // Mark driver availability as OFFLINE
      await DriverProfile.findOneAndUpdate(
        { userId: req.user.userId },
        { availabilityStatus: "OFFLINE" }
      );

      res.status(200).json({
        success: true,
        data: shift,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const driverController = new DriverController();


