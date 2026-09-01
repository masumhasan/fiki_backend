import { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { AuditLog } from "../models/AuditLog.js";
import { DriverProfile } from "../models/DriverProfile.js";
import { DriverShift } from "../models/DriverShift.js";
import { Trip } from "../models/Trip.js";
import { User } from "../models/User.js";
import { Setting } from "../models/Setting.js";
import bcrypt from "bcryptjs";
import { getFortnightlyPeriods } from "./driverController.js";
import { generateRecurringTripsForMaster } from "../utils/recurringTripUtils.js";

const updateDriverStatusSchema = z.object({
  approvalStatus: z.enum(["APPROVED", "REJECTED"]).optional(),
  accountStatus: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});

const createTripSchema = z.object({
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

async function syncDriverProfileWithApplication(user: any, profileDoc?: any) {
  let profile = profileDoc || (await DriverProfile.findOne({ userId: user._id }));
  if (!profile) {
    profile = new DriverProfile({
      userId: user._id,
      approvalStatus: "APPROVED",
      availabilityStatus: "OFFLINE",
    });
  }

  if (!profile.licenseNumber || !profile.licenseExpirationDate) {
    const userEmail = (user.email || "").toLowerCase().trim();
    const userName = (user.name || "").trim();

    const app = await mongoose.model("DriverApplication").findOne({
      $or: [
        userEmail ? { email: new RegExp(`^${userEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } : undefined,
        userName ? { fullName: new RegExp(`^${userName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } : undefined,
      ].filter(Boolean) as any,
    });

    let modified = false;
    if (app) {
      if (!profile.licenseNumber && app.licenseNumber) {
        profile.licenseNumber = app.licenseNumber;
        modified = true;
      }
      if (!profile.licenseExpirationDate && app.licenseExpirationDate) {
        profile.licenseExpirationDate = app.licenseExpirationDate;
        modified = true;
      }
    }

    if (profile.isNew || modified) {
      await profile.save();
    }
  }

  return profile;
}

async function resolveDriverProfile(id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const objId = new mongoose.Types.ObjectId(id);

  let profile = await DriverProfile.findOne({
    $or: [{ _id: objId }, { userId: objId }],
  });

  if (profile) {
    const user = await User.findById(profile.userId);
    if (user) {
      profile = await syncDriverProfileWithApplication(user, profile);
    }
    return profile;
  }

  const app = await mongoose.model("DriverApplication").findById(objId).catch(() => null);
  if (app) {
    if (app.userId) {
      profile = await DriverProfile.findOne({ userId: app.userId });
      if (profile) return profile;
    }
    if (app.driverProfileId) {
      profile = await DriverProfile.findById(app.driverProfileId);
      if (profile) return profile;
    }
  }

  const user = await User.findById(objId);
  if (user) {
    profile = await syncDriverProfileWithApplication(user);
    return profile;
  }

  return null;
}

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

      const profile = await syncDriverProfileWithApplication(user);

      const qStart = req.query.startDate as string;
      const qEnd = req.query.endDate as string;

      const joinDate = user.createdAt ? new Date(user.createdAt) : undefined;
      const availablePeriods = getFortnightlyPeriods(joinDate, 20);

      let activePeriod = availablePeriods[0];
      if (qStart && qEnd) {
        const found = availablePeriods.find((p: any) => p.startDate === qStart && p.endDate === qEnd);
        if (found) {
          activePeriod = found;
        } else {
          const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          const dS = new Date(qStart);
          const dE = new Date(qEnd);
          const labelStart = `${monthNames[dS.getUTCMonth()]} ${dS.getUTCDate()}`;
          const labelEnd = `${monthNames[dE.getUTCMonth()]} ${dE.getUTCDate()}, ${dE.getUTCFullYear()}`;
          const payDateObj = new Date(dE.getTime() + 4 * 24 * 60 * 60 * 1000);
          activePeriod = {
            id: `${qStart}_${qEnd}`,
            startDate: qStart,
            endDate: qEnd,
            label: `${labelStart} – ${labelEnd}`,
            isCurrent: false,
            expectedPayDate: `${monthNames[payDateObj.getUTCMonth()]} ${payDateObj.getUTCDate()}, ${payDateObj.getUTCFullYear()}`,
            payrollStatus: "Paid",
          };
        }
      }

      let customPeriodStatus = activePeriod.payrollStatus;
      if (profile?.periodPayrollStatuses) {
        const pMap = profile.periodPayrollStatuses as any;
        const getStatus = (pId: string) => (typeof pMap.get === "function" ? pMap.get(pId) : pMap[pId]);
        availablePeriods.forEach((p: any) => {
          const st = getStatus(p.id);
          if (st) p.payrollStatus = st as any;
        });
        const currentActiveSt = getStatus(activePeriod.id);
        if (currentActiveSt) {
          customPeriodStatus = currentActiveSt as any;
        }
      }

      const filterStart = new Date(`${activePeriod.startDate}T00:00:00.000Z`);
      const filterEnd = new Date(`${activePeriod.endDate}T23:59:59.999Z`);

      const trips = await Trip.find({
        driverId: user._id,
        createdAt: { $gte: filterStart, $lte: filterEnd },
      })
        .populate("passengerId", "name")
        .sort({ createdAt: -1 })
        .lean();

      const completedTrips = trips.filter((t) => t.status === "COMPLETED");
      const totalFare = completedTrips.reduce((sum, t) => sum + (t.fare || 0), 0);

      const hourlyRate = profile?.hourlyRate ?? 14.0;
      const defaultApprovedHours = profile?.approvedHours ?? 80.0;
      const tripBonusRate = profile?.tripBonusRate ?? 3.0;

      const approvedHours = activePeriod.isCurrent
        ? defaultApprovedHours
        : completedTrips.length > 0
        ? defaultApprovedHours
        : 0;

      const tripBonus = completedTrips.length * tripBonusRate;
      const regularWages = hourlyRate * approvedHours;
      const grossEarnings = regularWages + tripBonus;

      res.status(200).json({
        success: true,
        data: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          phone: user.phone || null,
          avatarUrl: user.avatarUrl || profile?.avatarUrl || "",
          accountStatus: user.accountStatus,
          createdAt: user.createdAt,
          selectedPeriod: activePeriod,
          availablePeriods,
          payrollStatus: customPeriodStatus || profile?.payrollStatus || "Approved",
          earnings: {
            hourlyRate,
            approvedHours,
            tripBonusRate,
            completedTripsCount: completedTrips.length,
            tripBonus,
            regularWages,
            grossEarnings,
          },
          profile: profile
            ? {
                licenseNumber: profile.licenseNumber || null,
                licenseExpirationDate: profile.licenseExpirationDate || null,
                vehicle: profile.vehicle || null,
                approvalStatus: profile.approvalStatus,
                availabilityStatus: profile.availabilityStatus,
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

      const drivers = await Promise.all(
        driverUsers.map(async (u) => {
          const p = await syncDriverProfileWithApplication(u);
          return {
            id: u._id.toString(),
            email: u.email,
            name: u.name,
            phone: u.phone,
            avatarUrl: u.avatarUrl || p?.avatarUrl || "",
            accountStatus: u.accountStatus,
            createdAt: u.createdAt,
            profile: p
              ? {
                  approvalStatus: p.approvalStatus,
                  availabilityStatus: p.availabilityStatus,
                  vehicle: p.vehicle,
                  licenseNumber: p.licenseNumber || null,
                  licenseExpirationDate: p.licenseExpirationDate || null,
                  completedTripsCount: p.completedTripsCount,
                  weeklySchedule: p.weeklySchedule || null,
                  oneTimeChanges: p.oneTimeChanges || [],
                }
              : null,
          };
        })
      );

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

      const sDate = tripData.startDate || tripData.pickupDate || tripData.recurringStartDate;
      const eDate = tripData.endDate || tripData.returnDate || tripData.recurringEndDate;
      const scheduledTime = sDate ? new Date(`${sDate}T${tripData.pickupTime || "09:00"}`) : undefined;

      const { fare, pickupAddress, destinationAddress, ...restOfTripData } = tripData;

      const trip = await Trip.create({
        passengerId: passenger._id,
        pickupLocation: { address: pickupAddress },
        dropoffLocation: { address: destinationAddress },
        fare: fare,
        quotedFare: fare,
        quotedAt: new Date(),
        status: "QUOTE_ACCEPTED",
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
      const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit as string, 10) || 1000));
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
      const now = new Date();
      if (!trip.assignedAt) trip.assignedAt = now;
      if (!trip.acceptedAt) trip.acceptedAt = now;
      await trip.save();

      await Trip.updateMany(
        { parentRequestId: trip._id },
        { driverId: driver._id, status: "ACCEPTED", assignedAt: now, acceptedAt: now }
      );

      const existingChildCount = await Trip.countDocuments({ parentRequestId: trip._id });
      if (existingChildCount === 0) {
        await generateRecurringTripsForMaster(trip);
      }

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

      Object.assign(trip, body);
      await trip.save();

      if (trip.parentRequestId) {
        // Single child trip updated
      } else {
        // Master request updated: sync child trips
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
      await Trip.deleteMany({
        $or: [{ _id: targetIdObj }, { parentRequestId: targetIdObj }],
      });

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
        message: "Trip and all associated recurring instances deleted successfully",
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

      await generateRecurringTripsForMaster(trip);

      const count = await Trip.countDocuments({ parentRequestId: trip._id });

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
        message: `Successfully regenerated ${count} trip legs for this request`,
        count,
        data: trip,
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
          .select("vehicle availabilityStatus")
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

      // Single-pass MongoDB Aggregations + Concurrent Promise.all Parallelization
      const [
        [facetResult],
        totalDrivers,
        activeDriversCount,
        onTripDriversCount,
        totalPassengers,
        newPassengersThisWeek,
        topDriversAgg,
        recentTripsDocs,
      ] = await Promise.all([
        Trip.aggregate([
          {
            $facet: {
              stats: [
                {
                  $group: {
                    _id: null,
                    totalTrips: { $sum: 1 },
                    completedTrips: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
                    pendingRequests: { $sum: { $cond: [{ $in: ["$status", ["REQUESTED", "QUOTE_COUNTERED", "QUOTE_SENT"]] }, 1, 0] } },
                    cancelledTrips: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } },
                    rejectedTrips: { $sum: { $cond: [{ $eq: ["$status", "QUOTE_DENIED"] }, 1, 0] } },
                    todayTrips: { $sum: { $cond: [{ $gte: ["$createdAt", todayStart] }, 1, 0] } },
                    totalRevenue: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, "$fare", 0] } },
                    outstandingPayments: {
                      $sum: {
                        $cond: [
                          { $not: [{ $in: ["$status", ["COMPLETED", "CANCELLED", "QUOTE_DENIED"]] }] },
                          { $ifNull: ["$quotedFare", { $ifNull: ["$fare", 0] }] },
                          0
                        ]
                      }
                    },
                    todayRevenue: {
                      $sum: {
                        $cond: [
                          { $and: [{ $eq: ["$status", "COMPLETED"] }, { $gte: ["$completedAt", todayStart] }] },
                          "$fare",
                          0
                        ]
                      }
                    },
                    weeklyRevenue: {
                      $sum: {
                        $cond: [
                          { $and: [{ $eq: ["$status", "COMPLETED"] }, { $gte: ["$completedAt", startOfWeek] }] },
                          "$fare",
                          0
                        ]
                      }
                    },
                    monthlyRevenue: {
                      $sum: {
                        $cond: [
                          { $and: [{ $eq: ["$status", "COMPLETED"] }, { $gte: ["$completedAt", startOfMonth] }] },
                          "$fare",
                          0
                        ]
                      }
                    },
                    yearlyRevenue: {
                      $sum: {
                        $cond: [
                          { $and: [{ $eq: ["$status", "COMPLETED"] }, { $gte: ["$completedAt", startOfYear] }] },
                          "$fare",
                          0
                        ]
                      }
                    }
                  }
                }
              ],
              monthlyPerformance: [
                { $match: { createdAt: { $gte: startOfYear } } },
                {
                  $group: {
                    _id: { $month: "$createdAt" },
                    requested: { $sum: 1 },
                    completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } }
                  }
                }
              ],
              revenueOverview: [
                { $match: { createdAt: { $gte: startOfYear } } },
                {
                  $group: {
                    _id: { $month: "$createdAt" },
                    monthlyRevenue: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, "$fare", 0] } },
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
              ],
              weeklyTripVolume: [
                { $match: { createdAt: { $gte: startOfWeek } } },
                {
                  $group: {
                    _id: { $dayOfWeek: "$createdAt" },
                    total: { $sum: 1 },
                    completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } }
                  }
                }
              ],
              monthlyTripVolume: [
                { $match: { createdAt: { $gte: startOfMonth } } },
                {
                  $group: {
                    _id: { $ceil: { $divide: [{ $dayOfMonth: "$createdAt" }, 7] } },
                    total: { $sum: 1 },
                    completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } }
                  }
                }
              ]
            }
          }
        ]),
        User.countDocuments({ role: "DRIVER", deletedAt: null }),
        DriverProfile.countDocuments({ availabilityStatus: { $in: ["ONLINE", "ASSIGNED", "ON_TRIP"] } }),
        DriverProfile.countDocuments({ availabilityStatus: "ON_TRIP" }),
        User.countDocuments({ role: "PASSENGER", deletedAt: null }),
        User.countDocuments({ role: "PASSENGER", deletedAt: null, createdAt: { $gte: startOfWeek } }),
        Trip.aggregate([
          { $match: { status: "COMPLETED", driverId: { $ne: null } } },
          { $group: { _id: "$driverId", tripsCount: { $sum: 1 }, revenueSum: { $sum: "$fare" } } },
          { $sort: { tripsCount: -1 } },
          { $limit: 10 }
        ]),
        Trip.find()
          .populate("passengerId", "name")
          .sort({ createdAt: -1 })
          .limit(10)
          .lean()
      ]);

      const s = facetResult?.stats?.[0] || {};
      const totalTrips = s.totalTrips || 0;
      const completedTrips = s.completedTrips || 0;
      const pendingRequests = s.pendingRequests || 0;
      const cancelledTrips = s.cancelledTrips || 0;
      const rejectedTrips = s.rejectedTrips || 0;
      const todayTrips = s.todayTrips || 0;
      const totalRevenue = s.totalRevenue || 0;
      const outstandingPayments = s.outstandingPayments || 0;
      const todayRevenue = s.todayRevenue || 0;
      const weeklyRevenue = s.weeklyRevenue || 0;
      const monthlyRevenue = s.monthlyRevenue || 0;
      const yearlyRevenue = s.yearlyRevenue || 0;

      const avgRidePrice = completedTrips > 0 ? totalRevenue / completedTrips : 0;

      // 2. Monthly Ride Performance (12 Months Jan - Dec)
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const monthlyPerformanceMap = new Map((facetResult?.monthlyPerformance || []).map((m: any) => [m._id, m]));
      const monthlyRidePerformance = monthNames.map((month, idx) => {
        const item = monthlyPerformanceMap.get(idx + 1) as any;
        return {
          month,
          requested: item?.requested || 0,
          completed: item?.completed || 0,
        };
      });

      // 3. Revenue Overview Monthly (12 Months)
      const revenueOverviewMap = new Map((facetResult?.revenueOverview || []).map((r: any) => [r._id, r]));
      const revenueOverview = monthNames.map((month, idx) => {
        const item = revenueOverviewMap.get(idx + 1) as any;
        return {
          month,
          monthlyRevenue: item?.monthlyRevenue || 0,
          outstanding: item?.outstanding || 0,
        };
      });

      // 4. Top Drivers
      const topDriverUserIds = topDriversAgg.map((d: any) => d._id);
      const driverUsers = await User.find({ _id: { $in: topDriverUserIds } }).select("name").lean();
      const driverProfiles = await DriverProfile.find({ userId: { $in: topDriverUserIds } }).select("userId availabilityStatus completedTripsCount").lean();
      
      const userMap = new Map(driverUsers.map((u: any) => [u._id.toString(), u]));
      const profileMap = new Map(driverProfiles.map((p: any) => [p.userId.toString(), p]));

      let topDrivers = topDriversAgg.map((item: any) => {
        const uidStr = item._id.toString();
        const u = userMap.get(uidStr);
        const p = profileMap.get(uidStr);
        const name = u?.name || "Driver";
        const initials = name.split(" ").map((n: string) => n[0]).join("").toUpperCase().substring(0, 2) || "DR";
        
        let statusStr = "Active";
        if (p?.availabilityStatus === "ASSIGNED") statusStr = "On Trip";
        else if (p?.availabilityStatus === "OFFLINE" || p?.availabilityStatus === "UNAVAILABLE") statusStr = "Off Duty";

        return {
          id: uidStr,
          initials,
          name,
          trips: item.tripsCount,
          rating: "5.0",
          revenue: `$${item.revenueSum.toLocaleString()}`,
          revenueVal: item.revenueSum,
          status: statusStr,
        };
      });

      // Fallback: If no completed trips yet, fetch approved drivers
      if (topDrivers.length === 0) {
        const approvedProfiles = await DriverProfile.find({ approvalStatus: "APPROVED" }).limit(6).lean();
        const appUserIds = approvedProfiles.map((p: any) => p.userId);
        const appUsers = await User.find({ _id: { $in: appUserIds } }).select("name").lean();
        const appUserMap = new Map(appUsers.map((u: any) => [u._id.toString(), u]));

        topDrivers = approvedProfiles.map((p: any) => {
          const uidStr = p.userId.toString();
          const u = appUserMap.get(uidStr);
          const name = u?.name || "Driver";
          const initials = name.split(" ").map((n: string) => n[0]).join("").toUpperCase().substring(0, 2) || "DR";
          let statusStr = "Active";
          if (p.availabilityStatus === "ASSIGNED") statusStr = "On Trip";
          else if (p.availabilityStatus === "OFFLINE" || p.availabilityStatus === "UNAVAILABLE") statusStr = "Off Duty";


          return {
            id: uidStr,
            initials,
            name,
            trips: p.completedTripsCount || 0,
            rating: "5.0",
            revenue: "$0",
            revenueVal: 0,
            status: statusStr,
          };
        });
      }

      // 5. Recent Ride Requests
      const colors = ["#082552", "#7439ed", "#2665e7", "#dc2626", "#0794b5", "#10ac7b"];
      const recentRideRequests = recentTripsDocs.map((t: any, idx: number) => {
        const rideId = `FT-${t._id.toString().substring(t._id.toString().length - 4).toUpperCase()}`;
        const passengerName = t.fullName || (t.passengerId as any)?.name || "Passenger";
        const initials = passengerName.split(" ").map((n: string) => n[0]).join("").toUpperCase().substring(0, 2) || "PA";
        const pickup = t.pickupLocation?.address || "Pickup";
        const dropoff = t.dropoffLocation?.address || t.returnDestinationAddress || "Destination";
        const route = `${pickup} → ${dropoff}`;
        
        let statusStr = "Pending";
        if (t.status === "COMPLETED") statusStr = "Completed";
        else if (["ACCEPTED", "DRIVER_ARRIVING", "DRIVER_ARRIVED", "IN_PROGRESS"].includes(t.status)) statusStr = "In Progress";
        else if (t.status === "CANCELLED" || t.status === "QUOTE_DENIED") statusStr = "Cancelled";
        
        const priceVal = t.fare || t.quotedFare || 0;
        const priceStr = `$${priceVal.toFixed(2)}`;
        const color = colors[idx % colors.length];

        return [
          initials,
          passengerName,
          route,
          statusStr,
          priceStr,
          color,
          rideId
        ];
      });

      // 6. Trip Volume Datasets (Weekly, Monthly, Yearly)
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const dayOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const weeklyVolumeMap = new Map((facetResult?.weeklyTripVolume || []).map((w: any) => [dayNames[w._id - 1], w]));
      const weeklyTripVolume = dayOrder.map((day) => {
        const item = weeklyVolumeMap.get(day) as any;
        return {
          date: day,
          total: item?.total || 0,
          completed: item?.completed || 0,
        };
      });

      const monthlyVolumeMap = new Map((facetResult?.monthlyTripVolume || []).map((m: any) => [m._id, m]));
      const monthlyTripVolume = [1, 2, 3, 4].map((w) => {
        const item = monthlyVolumeMap.get(w) as any;
        return {
          date: `Week ${w}`,
          total: item?.total || 0,
          completed: item?.completed || 0,
        };
      });

      const yearlyTripVolume = monthNames.map((month, idx) => {
        const item = monthlyPerformanceMap.get(idx + 1) as any;
        return {
          date: month,
          total: item?.requested || 0,
          completed: item?.completed || 0,
        };
      });

      // 7. Driver Status List for Dashboard Card
      const allApprovedProfiles = await DriverProfile.find({ approvalStatus: "APPROVED" }).limit(10).lean();
      const approvedUserIds = allApprovedProfiles.map((p: any) => p.userId);
      const approvedUsers = await User.find({ _id: { $in: approvedUserIds } }).select("name").lean();
      const approvedUserMap = new Map(approvedUsers.map((u: any) => [u._id.toString(), u]));

      const driverStatusColors = ["#10ac7b", "#f39200", "#2563eb", "#8345ed", "#0794b5"];
      const driverStatus = allApprovedProfiles.map((p: any, idx: number) => {
        const uidStr = p.userId.toString();
        const u = approvedUserMap.get(uidStr);
        const name = u?.name || "Driver";
        const initials = name.split(" ").map((n: string) => n[0]).join("").toUpperCase().substring(0, 2) || "DR";
        
        let statusStr = "On Duty";
        let color = driverStatusColors[idx % driverStatusColors.length];
        if (p.availabilityStatus === "ASSIGNED" || p.availabilityStatus === "ON_TRIP") {
          statusStr = "In Progress";
          color = "#f39200";
        } else if (p.availabilityStatus === "OFFLINE" || p.availabilityStatus === "UNAVAILABLE") {
          statusStr = "Off Duty";
          color = "#6b7280";
        }

        return {
          id: uidStr,
          initials,
          name,
          vehicle: "BMW M3 2022",
          status: statusStr,
          color,
        };
      });

      // 8. Activity Feed List for Dashboard Card
      const activityFeed = recentTripsDocs.slice(0, 5).map((t: any) => {
        const rideId = `T-${t._id.toString().substring(t._id.toString().length - 4).toUpperCase()}`;
        const passengerName = t.fullName || (t.passengerId as any)?.name || "Passenger";
        let title = `Trip ${rideId} requested by ${passengerName}`;
        let color = "#2563eb";
        if (t.status === "COMPLETED") {
          title = `Trip ${rideId} marked as completed`;
          color = "#10ac7b";
        } else if (["ACCEPTED", "DRIVER_ARRIVING", "DRIVER_ARRIVED", "IN_PROGRESS"].includes(t.status)) {
          title = `Trip ${rideId} updated to in-progress`;
          color = "#f39200";
        } else if (t.status === "CANCELLED" || t.status === "QUOTE_DENIED") {
          title = `Trip ${rideId} was cancelled`;
          color = "#dc2626";
        }
        const diffMs = Date.now() - new Date(t.createdAt).getTime();
        const mins = Math.max(1, Math.floor(diffMs / 60000));
        const time = mins < 60 ? `${mins} mins ago` : `${Math.floor(mins / 60)} hours ago`;
        return { title, time, color };
      });

      // 9. Driver Performance by period (real data from MongoDB)
      const nowTime = new Date();
      const weekAgo = new Date(nowTime.getTime() - 7 * 24 * 60 * 60 * 1000);
      const fortnightAgo = new Date(nowTime.getTime() - 14 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(nowTime.getTime() - 30 * 24 * 60 * 60 * 1000);
      const yearAgo = new Date(nowTime.getTime() - 365 * 24 * 60 * 60 * 1000);

      const getDriverPerfForPeriod = async (startDate: Date) => {
        const agg = await Trip.aggregate([
          { $match: { status: "COMPLETED", driverId: { $ne: null }, updatedAt: { $gte: startDate } } },
          { $group: { _id: "$driverId", trips: { $sum: 1 } } },
          { $sort: { trips: -1 } },
          { $limit: 5 }
        ]);

        if (agg.length > 0) {
          const userIds = agg.map(a => a._id);
          const users = await User.find({ _id: { $in: userIds } }).select("name").lean();
          const userMap = new Map(users.map(u => [u._id.toString(), u.name]));
          return agg.map(a => {
            const fullName = userMap.get(a._id.toString()) || "Driver";
            const parts = fullName.split(" ");
            const shortName = parts.length >= 2 ? `${parts[0]} ${parts[1][0]}.` : fullName;
            return {
              name: shortName,
              trips: a.trips
            };
          });
        }

        const approved = await DriverProfile.find({ approvalStatus: "APPROVED" }).limit(5).lean();
        const uIds = approved.map(p => p.userId);
        const uDocs = await User.find({ _id: { $in: uIds } }).select("name").lean();
        const uMap = new Map(uDocs.map(u => [u._id.toString(), u.name]));

        return approved.map(p => {
          const fullName = uMap.get(p.userId.toString()) || "Driver";
          const parts = fullName.split(" ");
          const shortName = parts.length >= 2 ? `${parts[0]} ${parts[1][0]}.` : fullName;
          return {
            name: shortName,
            trips: p.completedTripsCount || 0
          };
        });
      };

      const [weekPerf, fortnightPerf, monthPerf, yearPerf] = await Promise.all([
        getDriverPerfForPeriod(weekAgo),
        getDriverPerfForPeriod(fortnightAgo),
        getDriverPerfForPeriod(monthAgo),
        getDriverPerfForPeriod(yearAgo),
      ]);

      const driverPerformance = {
        week: weekPerf,
        fortnight: fortnightPerf,
        month: monthPerf,
        year: yearPerf,
      };

      res.status(200).json({
        success: true,
        data: {
          metrics: {
            todayTrips,
            pendingRequests,
            pendingTrips: pendingRequests,
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
          weeklyTripVolume,
          monthlyTripVolume,
          yearlyTripVolume,
          driverStatus,
          activityFeed,
          monthlyRidePerformance,
          revenueOverview,
          topDrivers,
          recentRideRequests,
          driverPerformance,
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
  async updateDriverProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, error: { code: "INVALID_ID", message: "Invalid driver ID format" } });
        return;
      }

      const { name, phone, email, licenseNumber, licenseExpirationDate } = req.body;

      const driverUser = await User.findOne({ _id: id, role: "DRIVER" });
      if (!driverUser) {
        res.status(404).json({ success: false, error: { code: "DRIVER_NOT_FOUND", message: "Driver not found" } });
        return;
      }

      // Update User fields
      if (name !== undefined) driverUser.name = name;
      if (phone !== undefined) driverUser.phone = phone;
      if (email !== undefined) driverUser.email = email.toLowerCase();
      await driverUser.save();

      // Update or create DriverProfile
      let profile = await DriverProfile.findOne({ userId: id });
      if (!profile) {
        profile = new DriverProfile({
          userId: id,
          approvalStatus: "APPROVED",
          availabilityStatus: "ONLINE",
        });
      }

      if (licenseNumber !== undefined) profile.licenseNumber = licenseNumber;
      if (licenseExpirationDate !== undefined) profile.licenseExpirationDate = licenseExpirationDate;
      await profile.save();

      res.status(200).json({
        success: true,
        message: "Driver profile updated successfully",
        data: {
          id: driverUser._id.toString(),
          name: driverUser.name,
          phone: driverUser.phone,
          email: driverUser.email,
          profile: {
            licenseNumber: profile.licenseNumber,
            licenseExpirationDate: profile.licenseExpirationDate,
            approvalStatus: profile.approvalStatus,
            availabilityStatus: profile.availabilityStatus,
          }
        }
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

      const profile = await resolveDriverProfile(id);

      if (!profile) {
        res.status(404).json({ success: false, error: { code: "PROFILE_NOT_FOUND", message: "Driver profile not found" } });
        return;
      }

      profile.weeklySchedule = weeklySchedule;
      await profile.save();

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

      const profile = await resolveDriverProfile(id);
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

      const profile = await resolveDriverProfile(id);
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

      const profile = await resolveDriverProfile(id);
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

      const profile = await resolveDriverProfile(id);
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

  async getDriverEarningsList(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const now = new Date();
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

      // Fetch all driver profiles
      const profiles = await DriverProfile.find({ approvalStatus: "APPROVED" }).lean();
      const userIds = profiles.map((p: any) => p.userId);
      const users = await User.find({ _id: { $in: userIds } }).select("name email phone avatarUrl").lean();
      const userMap = new Map(users.map((u: any) => [u._id.toString(), u]));

      // Fetch completed trip counts in past 14 days per driver
      const tripAgg = await Trip.aggregate([
        {
          $match: {
            driverId: { $in: userIds },
            status: "COMPLETED",
            createdAt: { $gte: fourteenDaysAgo }
          }
        },
        {
          $group: {
            _id: "$driverId",
            completedCount: { $sum: 1 }
          }
        }
      ]);

      const tripCountMap = new Map(tripAgg.map((item: any) => [item._id.toString(), item.completedCount]));

      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const payPeriodStartStr = `${monthNames[fourteenDaysAgo.getMonth()]} ${fourteenDaysAgo.getDate()}`;
      const payPeriodEndStr = `${monthNames[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
      const payPeriodRange = `${payPeriodStartStr} – ${payPeriodEndStr}`;

      const drivers = profiles.map((p: any) => {
        const uidStr = p.userId.toString();
        const u = userMap.get(uidStr);
        const name = u?.name || "Driver";
        const email = u?.email || "";
        const phone = u?.phone || "";

        const hourlyRate = p.hourlyRate ?? 14.0;
        const approvedHours = p.approvedHours ?? 80.0;
        const tripBonusRate = p.tripBonusRate ?? 3.0;
        const completedTrips = tripCountMap.get(uidStr) || p.completedTripsCount || 0;
        const tripBonus = completedTrips * tripBonusRate;
        const regularWages = hourlyRate * approvedHours;
        const grossEarnings = regularWages + tripBonus;

        return {
          driverId: uidStr,
          name,
          email,
          phone,
          avatarUrl: u?.avatarUrl || p.avatarUrl || "",
          vehicle: p.vehicle ? `${p.vehicle.make || ""} ${p.vehicle.model || ""}`.trim() || "Unassigned" : "Unassigned",
          licensePlate: p.vehicle?.licensePlate || "N/A",
          hourlyRate,
          approvedHours,
          tripBonusRate,
          completedTrips,
          tripBonus,
          regularWages,
          grossEarnings,
          payrollStatus: p.payrollStatus || "Approved",
        };
      });

      // Calculate summary totals across all drivers
      const totalPayroll = drivers.reduce((sum: number, d: any) => sum + d.grossEarnings, 0);
      const avgHourlyRate = drivers.length > 0 ? (drivers.reduce((sum: number, d: any) => sum + d.hourlyRate, 0) / drivers.length) : 14.0;
      const totalApprovedHours = drivers.reduce((sum: number, d: any) => sum + d.approvedHours, 0);

      res.status(200).json({
        success: true,
        data: {
          payPeriodRange,
          summary: {
            totalPayroll,
            avgHourlyRate: Math.round(avgHourlyRate * 100) / 100,
            totalApprovedHours,
            totalDriversCount: drivers.length,
          },
          drivers,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateDriverEarnings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const driverId = req.params.driverId as string;
      if (!driverId || !mongoose.Types.ObjectId.isValid(driverId)) {
        res.status(400).json({ success: false, error: { code: "INVALID_ID", message: "Invalid driver ID format" } });
        return;
      }

      const { hourlyRate, approvedHours, tripBonusRate, payrollStatus, periodId } = req.body;

      const profile = await resolveDriverProfile(driverId);
      if (!profile) {
        res.status(404).json({ success: false, error: { code: "PROFILE_NOT_FOUND", message: "Driver profile not found" } });
        return;
      }

      if (typeof hourlyRate === "number" && hourlyRate >= 0) {
        profile.hourlyRate = hourlyRate;
      }
      if (typeof approvedHours === "number" && approvedHours >= 0) {
        profile.approvedHours = approvedHours;
      }
      if (typeof tripBonusRate === "number" && tripBonusRate >= 0) {
        profile.tripBonusRate = tripBonusRate;
      }
      if (payrollStatus && typeof payrollStatus === "string") {
        profile.payrollStatus = payrollStatus;
        if (periodId && typeof periodId === "string") {
          if (!profile.periodPayrollStatuses) {
            profile.periodPayrollStatuses = new Map();
          }
          profile.periodPayrollStatuses.set(periodId, payrollStatus);
          profile.markModified("periodPayrollStatuses");
        }
      }

      await profile.save();

      res.status(200).json({
        success: true,
        data: {
          driverId,
          hourlyRate: profile.hourlyRate,
          approvedHours: profile.approvedHours,
          tripBonusRate: profile.tripBonusRate,
          payrollStatus: profile.payrollStatus,
          periodId: periodId || null,
        },
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

  async getScheduleOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      // Accept weekStart query param or default to current week's Monday
      let startOfWeek: Date;
      if (req.query.weekStart && typeof req.query.weekStart === "string") {
        const parts = req.query.weekStart.split("-").map(Number);
        if (parts.length === 3) {
          startOfWeek = new Date(parts[0], parts[1] - 1, parts[2]);
        } else {
          startOfWeek = new Date(todayStart);
        }
      } else {
        const currentDayOfWeek = now.getDay(); // 0=Sun, 1=Mon...
        const distanceToMon = (currentDayOfWeek + 6) % 7;
        startOfWeek = new Date(todayStart);
        startOfWeek.setDate(startOfWeek.getDate() - distanceToMon);
      }

      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(endOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);

      // Month names & Day names formatting
      const monthShortNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const dayAbbrKeys = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const dayHeaderNames = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

      // Top range label e.g. "Jul 14 – Jul 20, 2026"
      const startMonth = monthShortNames[startOfWeek.getMonth()];
      const endMonth = monthShortNames[endOfWeek.getMonth()];
      const weekRangeLabel = `${startMonth} ${startOfWeek.getDate()} – ${endMonth} ${endOfWeek.getDate()}, ${endOfWeek.getFullYear()}`;

      // Build 7 days headers array
      const weekDays: Array<{ day: string; date: string; dateStr: string; dayOfWeek: number }> = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(startOfWeek);
        d.setDate(d.getDate() + i);
        weekDays.push({
          day: dayHeaderNames[i],
          date: `${monthShortNames[d.getMonth()]} ${d.getDate()}`,
          dateStr: d.toISOString().split("T")[0],
          dayOfWeek: d.getDay(),
        });
      }

      // Query approved drivers and all shifts in current week
      const profiles = await DriverProfile.find({ approvalStatus: "APPROVED" }).lean();
      const userIds = profiles.map((p: any) => p.userId);
      const users = await User.find({ _id: { $in: userIds } }).select("name email phone avatarUrl").lean();
      const userMap = new Map(users.map((u: any) => [u._id.toString(), u]));

      const weekShifts = await DriverShift.find({
        driverId: { $in: userIds },
        createdAt: { $gte: startOfWeek, $lte: endOfWeek }
      }).lean();

      // Helper map for shifts: key = `${driverId}_${shiftDate}`
      const shiftMap = new Map();
      weekShifts.forEach((s: any) => {
        const key = `${s.driverId.toString()}_${s.shiftDate}`;
        shiftMap.set(key, s);
      });

      // Process each driver's 7 days schedule & status
      const avatarTones = [
        "bg-blue-600", "bg-emerald-600", "bg-violet-600", "bg-amber-600",
        "bg-rose-600", "bg-[#173d76]", "bg-teal-600", "bg-indigo-600"
      ];

      let scheduledTodayCount = 0;
      let workingNowCount = 0;
      let offTodayCount = 0;
      let scheduleIssuesCount = 0;

      const todayStr = todayStart.toISOString().split("T")[0];

      const drivers = profiles.map((p: any, pIdx: number) => {
        const uidStr = p.userId.toString();
        const u = userMap.get(uidStr);
        const name = u?.name || "Driver";
        const initials = name.split(" ").map((n: string) => n[0]).join("").substring(0, 2).toUpperCase();
        const tone = avatarTones[pIdx % avatarTones.length];

        const avatarUrl = u?.avatarUrl || p.avatarUrl || "";
        const weeklyScheduleConfig = p.weeklySchedule || [];
        const configMap = new Map(weeklyScheduleConfig.map((s: any) => [s.day, s]));

        let totalWeekMinutes = 0;
        const shifts = weekDays.map((wd) => {
          const dayKey = dayAbbrKeys[wd.dayOfWeek];
          const cfg = configMap.get(dayKey) as any;
          const isWorking = cfg ? cfg.working !== false : (wd.dayOfWeek >= 1 && wd.dayOfWeek <= 5);
          const startTimeStr = cfg?.startTime || "08:00 AM";
          const endTimeStr = cfg?.endTime || "04:00 PM";

          const shiftKey = `${uidStr}_${wd.dateStr}`;
          const actualShift = shiftMap.get(shiftKey);

          let status = "SCHEDULED";
          let label = "Scheduled";
          let toneClass = "bg-amber-100 border-amber-300 text-amber-800"; // Scheduled: --color-amber-100
          let hoursText = `${startTimeStr} – ${endTimeStr}`;
          let workDuration = "8h 00m";

          const dayDate = new Date(wd.dateStr);

          // Parse scheduled start time Date for comparison
          const [timePart, period] = startTimeStr.split(" ");
          const [hStr, mStr] = (timePart || "08:00").split(":");
          let scheduledHour = parseInt(hStr || "8", 10);
          if (period === "PM" && scheduledHour < 12) scheduledHour += 12;
          if (period === "AM" && scheduledHour === 12) scheduledHour = 0;
          const scheduledStartDate = new Date(dayDate);
          scheduledStartDate.setHours(scheduledHour, parseInt(mStr || "0", 10), 0, 0);

          if (!isWorking) {
            status = "DAY_OFF";
            label = "Day off";
            toneClass = "bg-slate-100 border-slate-200 text-slate-500"; // Day off: --color-slate-100
            hoursText = "Day off";
            workDuration = "—";
          } else {
            totalWeekMinutes += 8 * 60; // 8 hours scheduled

            if (actualShift && actualShift.startedAt) {
              const startedDate = new Date(actualShift.startedAt);
              const isLate = startedDate.getTime() > scheduledStartDate.getTime() + 5 * 60 * 1000; // 5m grace period

              if (isLate) {
                status = "LATE";
                label = "Late";
                toneClass = "bg-orange-100 border-orange-300 text-orange-800"; // Late: Less reddish than Absent
              } else {
                status = "PRESENT";
                label = "Present";
                toneClass = "bg-emerald-100 border-emerald-300 text-emerald-800"; // Present: --color-emerald-100
              }
            } else {
              // No shift started yet
              if (now.getTime() > scheduledStartDate.getTime()) {
                status = "ABSENT";
                label = "Absent";
                toneClass = "bg-rose-100 border-rose-300 text-rose-800"; // Absent: Reddish
              } else {
                status = "SCHEDULED";
                label = "Scheduled";
                toneClass = "bg-amber-100 border-amber-300 text-amber-800"; // Scheduled: --color-amber-100
              }
            }
          }

          // Count today's metrics
          if (wd.dateStr === todayStr) {
            if (isWorking) scheduledTodayCount++;
            else offTodayCount++;

            if (actualShift?.status === "IN_PROGRESS") workingNowCount++;
            if (status === "ABSENT" || status === "LATE") scheduleIssuesCount++;
          }

          return {
            dateStr: wd.dateStr,
            day: wd.day,
            status,
            label,
            toneClass,
            startTime: startTimeStr,
            endTime: endTimeStr,
            hoursText,
            workDuration,
          };
        });

        const totalHours = Math.floor(totalWeekMinutes / 60);

        return {
          id: p._id.toString(),
          driverId: uidStr,
          name,
          email: u?.email || "",
          phone: u?.phone || "",
          initials,
          tone,
          total: `${totalHours}h 00m`,
          avatarUrl,
          shifts,
          weeklySchedule: weeklyScheduleConfig,
        };
      });

      res.status(200).json({
        success: true,
        data: {
          weekStartStr: startOfWeek.toISOString().split("T")[0],
          weekEndStr: endOfWeek.toISOString().split("T")[0],
          weekRangeLabel,
          weekDays,
          metrics: {
            scheduledToday: scheduledTodayCount,
            workingNow: workingNowCount,
            offToday: offTodayCount,
            scheduleIssues: scheduleIssuesCount,
          },
          drivers,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const adminController = new AdminController();
