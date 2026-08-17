import { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { AuditLog } from "../models/AuditLog.js";
import { DriverProfile } from "../models/DriverProfile.js";
import { Trip } from "../models/Trip.js";
import { User } from "../models/User.js";

const updateDriverStatusSchema = z.object({
  approvalStatus: z.enum(["APPROVED", "REJECTED"]).optional(),
  accountStatus: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});

const createTripSchema = z.object({
  passengerId: z.string().min(1, "Passenger ID is required"),
  pickupAddress: z.string().min(1, "Pickup address is required"),
  dropoffAddress: z.string().min(1, "Dropoff address is required"),
  fare: z.number().positive().optional(),
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

      const driverUsers = await User.find(userFilter).skip(skip).limit(limit).lean();
      const totalDrivers = await User.countDocuments(userFilter);

      const userIds = driverUsers.map((u) => u._id);

      const profileFilter: Record<string, unknown> = { userId: { $in: userIds } };
      if (approvalStatus) profileFilter.approvalStatus = approvalStatus;
      if (availabilityStatus) profileFilter.availabilityStatus = availabilityStatus;

      const profiles = await DriverProfile.find(profileFilter).lean();
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
        res.status(422).json({
          success: false,
          error: { code: "VALIDATION_FAILED", message: "Invalid trip payload", details: parsed.error.flatten().fieldErrors },
        });
        return;
      }

      const { passengerId, pickupAddress, dropoffAddress, fare } = parsed.data;

      const passenger = await User.findById(passengerId);
      if (!passenger) {
        res.status(404).json({ success: false, error: { code: "USER_NOT_FOUND", message: "Passenger user not found" } });
        return;
      }

      const trip = await Trip.create({
        passengerId,
        pickupLocation: { address: pickupAddress },
        dropoffLocation: { address: dropoffAddress },
        fare,
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
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const todayTrips = await Trip.countDocuments({ createdAt: { $gte: todayStart } });
      const pendingRequests = await Trip.countDocuments({ status: { $in: ["REQUESTED", "QUOTE_COUNTERED"] } });
      const activeDriversCount = await DriverProfile.countDocuments({ availabilityStatus: { $in: ["ONLINE", "ON_TRIP", "ASSIGNED"] } });
      const completedTripsCount = await Trip.countDocuments({ status: "COMPLETED" });

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
      sevenDaysAgo.setHours(0, 0, 0, 0);

      const weeklyTripsAgg = await Trip.aggregate([
        { $match: { createdAt: { $gte: sevenDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            total: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] }
            }
          }
        },
        { $sort: { _id: 1 } }
      ]);

      const weeklyMap = new Map(weeklyTripsAgg.map((w: any) => [w._id, { total: w.total, completed: w.completed }]));
      const weeklyTripVolume = [];
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      
      for (let i = 0; i < 7; i++) {
        const d = new Date(sevenDaysAgo);
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split("T")[0];
        weeklyTripVolume.push({
          date: days[d.getDay()],
          total: weeklyMap.get(dateStr)?.total || 0,
          completed: weeklyMap.get(dateStr)?.completed || 0,
        });
      }

      // Fetch active drivers
      const activeProfiles = await DriverProfile.find({ availabilityStatus: { $in: ["ONLINE", "ON_TRIP", "ASSIGNED"] } })
        .populate("userId", "name")
        .limit(5)
        .lean();
        
      const colors = ["#082552", "#7439ed", "#2665e7", "#dc2626", "#0794b5", "#10ac7b"];
      const driverStatus = activeProfiles.map((p: any, idx: number) => ({
        id: p.userId?._id,
        name: p.userId?.name || "Unknown",
        initials: p.userId?.name ? p.userId.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().substring(0, 2) : "DR",
        vehicle: p.vehicle?.model ? p.vehicle.model : (typeof p.vehicle === 'string' ? p.vehicle : "Standard Vehicle"),
        status: p.availabilityStatus === "ONLINE" ? "Active" : p.availabilityStatus === "ON_TRIP" ? "On Trip" : p.availabilityStatus === "ASSIGNED" ? "Assigned" : "Active",
        color: colors[idx % colors.length],
      }));

      // Fetch Activity Feed (from recent trips)
      const recentTrips = await Trip.find()
        .populate("passengerId", "name")
        .sort({ updatedAt: -1 })
        .limit(6)
        .lean();

      const activityFeed = recentTrips.map((t: any) => {
        const tripId = `T-${t._id.toString().substring(t._id.toString().length - 4).toUpperCase()}`;
        const passengerName = t.passengerId?.name || "Unknown";
        
        let title = `Trip ${tripId} updated`;
        let color = "#3b82f6";
        
        if (t.status === "COMPLETED") {
           title = `Trip ${tripId} completed successfully`;
           color = "#22c55e";
        } else if (t.status === "REQUESTED") {
           title = `New ride request from ${passengerName}`;
           color = "#3b82f6";
        } else if (t.status === "QUOTE_COUNTERED") {
           title = `Trip ${tripId} counter-offered by passenger`;
           color = "#f59e0b";
        } else if (t.status === "CANCELLED" || t.status === "QUOTE_DENIED") {
           title = `Trip ${tripId} was rejected or cancelled`;
           color = "#ff5a5f";
        } else if (t.status === "IN_PROGRESS" || t.status === "DRIVER_ARRIVING" || t.status === "DRIVER_ARRIVED") {
           title = `Trip ${tripId} in progress`;
           color = "#16345e";
        } else if (t.status === "ACCEPTED" || t.status === "QUOTE_ACCEPTED") {
           title = `Trip ${tripId} approved / driver assigned`;
           color = "#8345ed";
        }

        const diffMs = Date.now() - new Date(t.updatedAt).getTime();
        const diffMins = Math.floor(diffMs / 60000);
        let timeAgo = `${diffMins} min ago`;
        if (diffMins > 60) {
          const diffHrs = Math.floor(diffMins / 60);
          timeAgo = `${diffHrs}h ${diffMins % 60}m ago`;
        }
        if (diffMins > 1440) {
          const diffDays = Math.floor(diffMins / 1440);
          timeAgo = `${diffDays} days ago`;
        }

        return {
          title,
          time: timeAgo,
          color,
        };
      });

      const recentRideRequests = recentTrips.slice(0, 4).map((t: any, idx: number) => {
        const passengerName = t.passengerId?.name || "Passenger";
        const initials = passengerName.split(" ").map((n: string) => n[0]).join("").toUpperCase().substring(0, 2) || "PA";
        const pickup = t.pickupLocation?.address || "Unknown Pickup";
        const dropoff = t.dropoffLocation?.address || "Unknown Dropoff";
        
        let statusStr = "Pending";
        if (t.status === "COMPLETED") statusStr = "Completed";
        else if (t.status === "ACCEPTED" || t.status === "QUOTE_ACCEPTED") statusStr = "Approved";
        else if (t.status === "REQUESTED") statusStr = "Need Driver";
        else if (t.status === "IN_PROGRESS" || t.status === "DRIVER_ARRIVING" || t.status === "DRIVER_ARRIVED") statusStr = "Onboard";

        return [
          initials,
          passengerName,
          `${pickup} → ${dropoff}`,
          statusStr,
          t.createdAt ? new Date(t.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Recently",
          colors[idx % colors.length]
        ];
      });

      res.status(200).json({
        success: true,
        data: {
          metrics: {
            todayTrips,
            pendingRequests,
            activeDrivers: activeDriversCount,
            completedTrips: completedTripsCount,
          },
          weeklyTripVolume,
          driverStatus,
          activityFeed,
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
      });

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
}

export const adminController = new AdminController();
