import { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { AuditLog } from "../models/AuditLog.js";
import { DriverProfile } from "../models/DriverProfile.js";
import { DriverShift } from "../models/DriverShift.js";
import { DriverApplication } from "../models/DriverApplication.js";
import { Trip } from "../models/Trip.js";
import { User } from "../models/User.js";
import { Setting } from "../models/Setting.js";
import bcrypt from "bcryptjs";
import { getFortnightlyPeriods } from "./driverController.js";
import { generateRecurringTripsForMaster } from "../utils/recurringTripUtils.js";
import { parseCentralDateTime, calculateShiftDuration, getCentralTodayStr, getCentralTomorrowStr } from "../utils/dateUtils.js";

const updateDriverStatusSchema = z.object({
  approvalStatus: z.enum(["APPROVED", "REJECTED"]).optional(),
  accountStatus: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});

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

      const [trips, shifts] = await Promise.all([
        Trip.find({
          driverId: user._id,
          createdAt: { $gte: filterStart, $lte: filterEnd },
        })
          .select("_id status fare pickupLocation dropoffLocation fullName passengerId createdAt")
          .populate("passengerId", "name")
          .sort({ createdAt: -1 })
          .lean(),
        DriverShift.find({
          driverId: user._id,
          startedAt: { $gte: filterStart, $lte: filterEnd },
        }).lean(),
      ]);

      const completedTrips = trips.filter((t) => t.status === "COMPLETED");
      const totalFare = completedTrips.reduce((sum, t) => sum + (t.fare || 0), 0);

      const hourlyRate = profile?.hourlyRate ?? 14.0;
      const tripBonusRate = profile?.tripBonusRate ?? 3.0;

      // Calculate actual clocked hours from driver shift logs
      const totalMinutes = shifts.reduce((sum: number, s: any) => {
        if (s.totalMinutes !== undefined && s.totalMinutes !== null) {
          return sum + s.totalMinutes;
        }
        if (s.startedAt && s.endedAt) {
          return sum + Math.max(0, Math.floor((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60000));
        }
        if (s.startedAt && s.status === "IN_PROGRESS") {
          return sum + Math.max(0, Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 60000));
        }
        return sum;
      }, 0);
      const clockedHours = Number((totalMinutes / 60).toFixed(2));

      const tripBonus = Math.round((completedTrips.length * tripBonusRate) * 100) / 100;
      const regularWages = Math.round((hourlyRate * clockedHours) * 100) / 100;
      const grossEarnings = Math.round((regularWages + tripBonus) * 100) / 100;

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
            clockedHours,
            approvedHours: clockedHours,
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
            passengerName: t.fullName || (t.passengerId as any)?.name || null,
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
      const scheduledTime = sDate ? parseCentralDateTime(tripData.pickupTime || "09:00", sDate) : undefined;

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
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 10));
      const skip = (page - 1) * limit;

      const { status, type, search, tab } = req.query;
      const baseFilter: Record<string, unknown> = {};

      let sortLogic: any = { pickupDate: 1, startDate: 1, scheduledTime: 1, createdAt: 1 };

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
      let needDriver = 0;
      let completedCount = 0;
      let totalSummaryTrips = 0;
      
      summaryData.forEach(item => {
        totalSummaryTrips += item.count;
        if (item._id === "IN_PROGRESS") onboardNow += item.count;
        else if (item._id === "REQUESTED") needDriver += item.count;
        else if (item._id === "COMPLETED") completedCount += item.count;
      });

      const todayStr = getCentralTodayStr();
      const tomorrowStr = getCentralTomorrowStr();

      // Build filters for each tab
      const getTabFilter = (tabName: string): Record<string, unknown> => {
        const f: Record<string, unknown> = { ...baseFilter };
        if (tabName === "completed") {
          f.status = "COMPLETED";
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
      const [todayCount, nextDayCount, completedTabCount, missedCount, allCount] = await Promise.all([
        Trip.countDocuments(getTabFilter("today")),
        Trip.countDocuments(getTabFilter("nextDay")),
        Trip.countDocuments(getTabFilter("completed")),
        Trip.countDocuments(getTabFilter("missed")),
        Trip.countDocuments(getTabFilter("all")),
      ]);

      const activeTab = tab ? (tab as string) : "all";
      const filter: Record<string, unknown> = getTabFilter(activeTab);

      if (activeTab === "missed") {
        sortLogic = { pickupDate: -1, startDate: -1, scheduledTime: -1, createdAt: -1 };
      }

      if (status) {
        const statusStr = status as string;
        if (statusStr.includes(",")) {
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

      if (trip.status !== "ACCEPTED") {
        res.status(400).json({
          success: false,
          error: {
            code: "RIDE_NOT_APPROVED",
            message: "Cannot assign driver before approving the ride request. Please approve the request first.",
          },
        });
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
      const masterIdObj = trip.parentRequestId ? new mongoose.Types.ObjectId(trip.parentRequestId.toString()) : targetIdObj;

      await Trip.deleteMany({
        $or: [
          { _id: masterIdObj },
          { parentRequestId: masterIdObj },
          { _id: targetIdObj },
        ],
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
        .populate("passengerId", "name email phone avatarUrl")
        .populate("driverId", "name email phone avatarUrl")
        .lean();

      if (!trip) {
        res.status(404).json({ success: false, error: { code: "TRIP_NOT_FOUND", message: "Trip not found" } });
        return;
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
        ? completedChildTrips.reduce((sum: number, c: any) => sum + (typeof c.fare === "number" && !isNaN(c.fare) && c.fare > 0 ? c.fare : effectiveFare), 0)
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

      const allowedStatuses: string[] = ["REQUESTED", "QUOTE_COUNTERED", "QUOTE_SENT", "ACCEPTED"];
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
      if (trip.status === "REQUESTED" || trip.status === "QUOTE_COUNTERED") {
        trip.status = "QUOTE_SENT";
      }
      await trip.save();

      // Sync quotedFare and quoteNote to child legs if this is a master request
      if (!trip.parentRequestId) {
        await Trip.updateMany(
          { parentRequestId: trip._id },
          {
            quotedFare: trip.quotedFare,
            quoteNote: trip.quoteNote,
            ...(trip.status === "QUOTE_SENT" ? { status: "QUOTE_SENT" } : {}),
          }
        );
      }

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
      const endOfToday = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

      const startOfWeek = new Date(todayStart);
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()); // Sunday start of week

      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      const startOfYear = new Date(now.getFullYear(), 0, 1);
      const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);

      // Past 7 days
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const weekDays: Date[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(todayStart);
        d.setDate(d.getDate() - i);
        weekDays.push(d);
      }
      const startOfPast7Days = weekDays[0];

      // Past 14 days
      const fortnightDays: Date[] = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(todayStart);
        d.setDate(d.getDate() - i);
        fortnightDays.push(d);
      }
      const startOfFortnight = fortnightDays[0];

      // Exclude parent container requests whose child legs exist to avoid double-counting
      const parentIdsWithChildren = await Trip.find({ parentRequestId: { $exists: true, $ne: null } }).distinct("parentRequestId");
      const actualTripMatch = { _id: { $nin: parentIdsWithChildren } };

      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

      // Run parallel aggregations for metrics and multi-period datasets
      const [
        todayTrips,
        totalTrips,
        totalRideRequests,
        completedTrips,
        pendingRequests,
        cancelledTrips,
        rejectedTrips,
        activeTrips,
        revenueAgg,
        revenueSummaryAgg,
        yearAgg,
        monthAgg,
        weekAgg,
        fortnightAgg,
        totalDrivers,
        activeDriversCount,
        onTripDriversCount,
        totalPassengers,
        newPassengersThisWeek,
        topDriversAgg,
        recentTripsDocs,
        pendingRideRequestsDocs,
      ] = await Promise.all([
        Trip.countDocuments({
          ...actualTripMatch,
          $or: [
            { createdAt: { $gte: todayStart } },
            { pickupDate: { $gte: todayStart, $lte: endOfToday } },
          ],
        }),
        Trip.countDocuments(actualTripMatch),
        Trip.countDocuments({ parentRequestId: { $exists: false } }),
        Trip.countDocuments({ ...actualTripMatch, status: "COMPLETED" }),
        Trip.countDocuments({
          parentRequestId: { $exists: false },
          status: { $in: ["REQUESTED", "QUOTE_COUNTERED", "QUOTE_SENT"] },
        }),
        Trip.countDocuments({ ...actualTripMatch, status: "CANCELLED" }),
        Trip.countDocuments({ ...actualTripMatch, status: "QUOTE_DENIED" }),
        Trip.countDocuments({
          ...actualTripMatch,
          status: { $in: ["ACCEPTED", "QUOTE_ACCEPTED", "DRIVER_ARRIVING", "DRIVER_ARRIVED", "IN_PROGRESS"] },
        }),
        Trip.aggregate([
          { $match: { ...actualTripMatch, status: "COMPLETED" } },
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: { $ifNull: ["$fare", { $ifNull: ["$quotedFare", 0] }] } },
            },
          },
        ]),
        Trip.aggregate([
          { $match: { ...actualTripMatch, status: "COMPLETED" } },
          {
            $group: {
              _id: null,
              todayRevenue: {
                $sum: {
                  $cond: [
                    { $gte: [{ $convert: { input: { $ifNull: ["$completedAt", "$updatedAt"] }, to: "date", onError: "$createdAt", onNull: "$createdAt" } }, todayStart] },
                    { $ifNull: ["$fare", { $ifNull: ["$quotedFare", 0] }] },
                    0,
                  ],
                },
              },
              weeklyRevenue: {
                $sum: {
                  $cond: [
                    { $gte: [{ $convert: { input: { $ifNull: ["$completedAt", "$updatedAt"] }, to: "date", onError: "$createdAt", onNull: "$createdAt" } }, startOfWeek] },
                    { $ifNull: ["$fare", { $ifNull: ["$quotedFare", 0] }] },
                    0,
                  ],
                },
              },
              fortnightRevenue: {
                $sum: {
                  $cond: [
                    { $gte: [{ $convert: { input: { $ifNull: ["$completedAt", "$updatedAt"] }, to: "date", onError: "$createdAt", onNull: "$createdAt" } }, startOfFortnight] },
                    { $ifNull: ["$fare", { $ifNull: ["$quotedFare", 0] }] },
                    0,
                  ],
                },
              },
              monthlyRevenue: {
                $sum: {
                  $cond: [
                    { $gte: [{ $convert: { input: { $ifNull: ["$completedAt", "$updatedAt"] }, to: "date", onError: "$createdAt", onNull: "$createdAt" } }, startOfMonth] },
                    { $ifNull: ["$fare", { $ifNull: ["$quotedFare", 0] }] },
                    0,
                  ],
                },
              },
              yearlyRevenue: {
                $sum: {
                  $cond: [
                    { $gte: [{ $convert: { input: { $ifNull: ["$completedAt", "$updatedAt"] }, to: "date", onError: "$createdAt", onNull: "$createdAt" } }, startOfYear] },
                    { $ifNull: ["$fare", { $ifNull: ["$quotedFare", 0] }] },
                    0,
                  ],
                },
              },
            },
          },
        ]),
        // 1. Year Aggregation (Jan - Dec strictly within current year)
        Trip.aggregate([
          { $match: { ...actualTripMatch } },
          { $addFields: { resolvedDate: { $convert: { input: { $ifNull: ["$pickupDate", { $ifNull: ["$startDate", "$createdAt"] }] }, to: "date", onError: "$createdAt", onNull: "$createdAt" } } } },
          { $match: { resolvedDate: { $gte: startOfYear, $lte: endOfYear } } },
          {
            $group: {
              _id: { $month: "$resolvedDate" },
              requested: { $sum: 1 },
              completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
              revenue: {
                $sum: {
                  $cond: [
                    { $eq: ["$status", "COMPLETED"] },
                    { $ifNull: ["$fare", { $ifNull: ["$quotedFare", 0] }] },
                    0,
                  ],
                },
              },
            },
          },
        ]),
        // 2. Month Aggregation (Weeks 1 - 4 of current month)
        Trip.aggregate([
          { $match: { ...actualTripMatch } },
          { $addFields: { resolvedDate: { $convert: { input: { $ifNull: ["$pickupDate", { $ifNull: ["$startDate", "$createdAt"] }] }, to: "date", onError: "$createdAt", onNull: "$createdAt" } } } },
          { $match: { resolvedDate: { $gte: startOfMonth, $lte: endOfMonth } } },
          {
            $group: {
              _id: { $ceil: { $divide: [{ $dayOfMonth: "$resolvedDate" }, 7] } },
              requested: { $sum: 1 },
              completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
              revenue: {
                $sum: {
                  $cond: [
                    { $eq: ["$status", "COMPLETED"] },
                    { $ifNull: ["$fare", { $ifNull: ["$quotedFare", 0] }] },
                    0,
                  ],
                },
              },
            },
          },
        ]),
        // 3. Week Aggregation (Past 7 days)
        Trip.aggregate([
          { $match: { ...actualTripMatch } },
          { $addFields: { resolvedDate: { $convert: { input: { $ifNull: ["$pickupDate", { $ifNull: ["$startDate", "$createdAt"] }] }, to: "date", onError: "$createdAt", onNull: "$createdAt" } } } },
          { $match: { resolvedDate: { $gte: startOfPast7Days, $lte: endOfToday } } },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$resolvedDate" } },
              requested: { $sum: 1 },
              completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
              revenue: {
                $sum: {
                  $cond: [
                    { $eq: ["$status", "COMPLETED"] },
                    { $ifNull: ["$fare", { $ifNull: ["$quotedFare", 0] }] },
                    0,
                  ],
                },
              },
            },
          },
        ]),
        // 4. Fortnight Aggregation (Past 14 days)
        Trip.aggregate([
          { $match: { ...actualTripMatch } },
          { $addFields: { resolvedDate: { $convert: { input: { $ifNull: ["$pickupDate", { $ifNull: ["$startDate", "$createdAt"] }] }, to: "date", onError: "$createdAt", onNull: "$createdAt" } } } },
          { $match: { resolvedDate: { $gte: startOfFortnight, $lte: endOfToday } } },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$resolvedDate" } },
              requested: { $sum: 1 },
              completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
              revenue: {
                $sum: {
                  $cond: [
                    { $eq: ["$status", "COMPLETED"] },
                    { $ifNull: ["$fare", { $ifNull: ["$quotedFare", 0] }] },
                    0,
                  ],
                },
              },
            },
          },
        ]),
        User.countDocuments({ role: "DRIVER", deletedAt: null }),
        DriverProfile.countDocuments({ availabilityStatus: { $in: ["ONLINE", "ASSIGNED", "ON_TRIP"] } }),
        DriverProfile.countDocuments({ availabilityStatus: "ON_TRIP" }),
        User.countDocuments({ role: "PASSENGER", deletedAt: null }),
        User.countDocuments({ role: "PASSENGER", deletedAt: null, createdAt: { $gte: startOfWeek } }),
        Trip.aggregate([
          { $match: { ...actualTripMatch, status: "COMPLETED", driverId: { $ne: null } } },
          { $group: { _id: "$driverId", tripsCount: { $sum: 1 }, revenueSum: { $sum: { $ifNull: ["$fare", { $ifNull: ["$quotedFare", 0] }] } } } },
          { $sort: { tripsCount: -1 } },
          { $limit: 10 },
        ]),
        Trip.find({ parentRequestId: { $exists: false } })
          .populate("passengerId", "name avatarUrl")
          .sort({ createdAt: -1 })
          .limit(10)
          .lean(),
        Trip.find({
          parentRequestId: { $exists: false },
          status: { $in: ["REQUESTED", "QUOTE_COUNTERED", "QUOTE_SENT"] },
        })
          .populate("passengerId", "name avatarUrl phone")
          .sort({ createdAt: -1 })
          .limit(10)
          .lean(),
      ]);

      const totalRevenue = revenueAgg[0]?.totalRevenue || 0;
      const todayRevenue = revenueSummaryAgg[0]?.todayRevenue || 0;
      const weeklyRevenue = revenueSummaryAgg[0]?.weeklyRevenue || 0;
      const fortnightRevenue = revenueSummaryAgg[0]?.fortnightRevenue || 0;
      const monthlyRevenue = revenueSummaryAgg[0]?.monthlyRevenue || 0;
      const yearlyRevenue = revenueSummaryAgg[0]?.yearlyRevenue || 0;
      const avgRidePrice = completedTrips > 0 ? totalRevenue / completedTrips : 0;

      // Map Year Performance
      const yearMap = new Map(yearAgg.map((y: any) => [y._id, y]));
      const yearRidePerf = monthNames.map((m, idx) => {
        const item = yearMap.get(idx + 1) as any;
        return {
          label: m,
          requested: item?.requested || 0,
          completed: item?.completed || 0,
          revenue: item?.revenue || 0,
        };
      });

      // Map Month Performance (4 weeks)
      const monthMap = new Map(monthAgg.map((m: any) => [m._id, m]));
      const monthRidePerf = [1, 2, 3, 4].map((w) => {
        const item = monthMap.get(w) as any;
        return {
          label: `Week ${w}`,
          requested: item?.requested || 0,
          completed: item?.completed || 0,
          revenue: item?.revenue || 0,
        };
      });

      // Map Week Performance (7 days)
      const weekMap = new Map(weekAgg.map((w: any) => [w._id, w]));
      const weekRidePerf = weekDays.map((d) => {
        const dateStr = d.toISOString().split("T")[0];
        const item = weekMap.get(dateStr) as any;
        return {
          label: dayNames[d.getDay()],
          dateStr,
          requested: item?.requested || 0,
          completed: item?.completed || 0,
          revenue: item?.revenue || 0,
        };
      });

      // Map Fortnight Performance (14 days)
      const fortnightMap = new Map(fortnightAgg.map((f: any) => [f._id, f]));
      const fortnightRidePerf = fortnightDays.map((d) => {
        const dateStr = d.toISOString().split("T")[0];
        const item = fortnightMap.get(dateStr) as any;
        return {
          label: `${d.getMonth() + 1}/${d.getDate()}`,
          dateStr,
          requested: item?.requested || 0,
          completed: item?.completed || 0,
          revenue: item?.revenue || 0,
        };
      });

      // Ride status distribution helper
      const formatStatusCounts = (res: any[]) => {
        const m = new Map(res.map((r: any) => [r._id, r.count]));
        const completed = m.get("COMPLETED") || 0;
        const inProgress = (m.get("IN_PROGRESS") || 0) + (m.get("DRIVER_ARRIVING") || 0) + (m.get("DRIVER_ARRIVED") || 0);
        const scheduled = (m.get("ACCEPTED") || 0) + (m.get("QUOTE_ACCEPTED") || 0);
        const pending = (m.get("REQUESTED") || 0) + (m.get("QUOTE_COUNTERED") || 0) + (m.get("QUOTE_SENT") || 0);
        const cancelled = (m.get("CANCELLED") || 0) + (m.get("QUOTE_DENIED") || 0);
        const total = completed + inProgress + scheduled + pending + cancelled;
        return { completed, inProgress, scheduled, pending, cancelled, total };
      };

      const getStatusDistForRange = async (startDate?: Date, endDate?: Date) => {
        const match: any = { ...actualTripMatch };
        if (startDate || endDate) {
          const dateFilter: any = {};
          if (startDate) dateFilter.$gte = startDate;
          if (endDate) dateFilter.$lte = endDate;
          const res = await Trip.aggregate([
            { $match: match },
            { $addFields: { resolvedDate: { $convert: { input: { $ifNull: ["$pickupDate", { $ifNull: ["$startDate", "$createdAt"] }] }, to: "date", onError: "$createdAt", onNull: "$createdAt" } } } },
            { $match: { resolvedDate: dateFilter } },
            { $group: { _id: "$status", count: { $sum: 1 } } },
          ]);
          return formatStatusCounts(res);
        }
        const res = await Trip.aggregate([
          { $match: match },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]);
        return formatStatusCounts(res);
      };

      const [statusWeek, statusFortnight, statusMonth, statusYear, statusAll] = await Promise.all([
        getStatusDistForRange(startOfPast7Days, endOfToday),
        getStatusDistForRange(startOfFortnight, endOfToday),
        getStatusDistForRange(startOfMonth, endOfMonth),
        getStatusDistForRange(startOfYear, endOfYear),
        getStatusDistForRange(),
      ]);

      const statusDistribution = {
        week: statusWeek,
        fortnight: statusFortnight,
        month: statusMonth,
        year: statusYear,
        all: statusAll,
      };

      // Top Drivers
      const topDriverUserIds = topDriversAgg.map((d: any) => d._id);
      const driverUsers = await User.find({ _id: { $in: topDriverUserIds } }).select("name avatarUrl").lean();
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
          avatarUrl: u?.avatarUrl || "",
          trips: item.tripsCount,
          rating: "5.0",
          revenue: `$${Number(item.revenueSum || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          revenueVal: item.revenueSum || 0,
          status: statusStr,
        };
      });

      if (topDrivers.length === 0) {
        const approvedProfiles = await DriverProfile.find({ approvalStatus: "APPROVED" }).limit(6).lean();
        const appUserIds = approvedProfiles.map((p: any) => p.userId);
        const appUsers = await User.find({ _id: { $in: appUserIds } }).select("name avatarUrl").lean();
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
            avatarUrl: u?.avatarUrl || "",
            trips: p.completedTripsCount || 0,
            rating: "5.0",
            revenue: "$0.00",
            revenueVal: 0,
            status: statusStr,
          };
        });
      }

      // Recent Ride Requests
      const colors = ["#082552", "#7439ed", "#2665e7", "#dc2626", "#0794b5", "#10ac7b"];
      const recentRideRequests = recentTripsDocs.map((t: any, idx: number) => {
        const rideId = `FT-${t._id.toString().substring(t._id.toString().length - 4).toUpperCase()}`;
        const passengerName = t.fullName || (t.passengerId as any)?.name || "Passenger";
        const initials = passengerName.split(" ").map((n: string) => n[0]).join("").toUpperCase().substring(0, 2) || "PA";
        const pickup = t.pickupLocation?.address || t.streetAddress || "Pickup";
        const dropoff = t.dropoffLocation?.address || t.destinationAddress || t.returnDestinationAddress || "Destination";
        const route = `${pickup} → ${dropoff}`;

        let statusStr = "Pending";
        if (t.status === "COMPLETED") statusStr = "Completed";
        else if (["ACCEPTED", "DRIVER_ARRIVING", "DRIVER_ARRIVED", "IN_PROGRESS"].includes(t.status)) statusStr = "In Progress";
        else if (t.status === "CANCELLED" || t.status === "QUOTE_DENIED") statusStr = "Cancelled";

        const priceVal = t.fare || t.quotedFare || 0;
        const priceStr = `$${Number(priceVal).toFixed(2)}`;
        const color = colors[idx % colors.length];
        const avatarUrl = t.passengerAvatarUrl || (t.passengerId as any)?.avatarUrl || "";

        return [
          initials,
          passengerName,
          route,
          statusStr,
          priceStr,
          color,
          rideId,
          avatarUrl,
        ];
      });

      // Driver Performance by period
      const nowTime = new Date();
      const weekAgo = new Date(nowTime.getTime() - 7 * 24 * 60 * 60 * 1000);
      const fortnightAgo = new Date(nowTime.getTime() - 14 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(nowTime.getTime() - 30 * 24 * 60 * 60 * 1000);
      const yearAgo = new Date(nowTime.getTime() - 365 * 24 * 60 * 60 * 1000);

      const getDriverPerfForPeriod = async (startDate: Date) => {
        const agg = await Trip.aggregate([
          { $match: { ...actualTripMatch, status: "COMPLETED", driverId: { $ne: null }, updatedAt: { $gte: startDate } } },
          { $group: { _id: "$driverId", trips: { $sum: 1 } } },
          { $sort: { trips: -1 } },
          { $limit: 5 },
        ]);

        if (agg.length > 0) {
          const userIds = agg.map((a) => a._id);
          const users = await User.find({ _id: { $in: userIds } }).select("name").lean();
          const uMap = new Map(users.map((u) => [u._id.toString(), u.name]));
          return agg.map((a) => {
            const fullName = uMap.get(a._id.toString()) || "Driver";
            const parts = fullName.split(" ");
            const shortName = parts.length >= 2 ? `${parts[0]} ${parts[1][0]}.` : fullName;
            return {
              name: shortName,
              trips: a.trips,
            };
          });
        }

        const approved = await DriverProfile.find({ approvalStatus: "APPROVED" }).limit(5).lean();
        const uIds = approved.map((p) => p.userId);
        const uDocs = await User.find({ _id: { $in: uIds } }).select("name").lean();
        const uMap = new Map(uDocs.map((u) => [u._id.toString(), u.name]));

        return approved.map((p) => {
          const fullName = uMap.get(p.userId.toString()) || "Driver";
          const parts = fullName.split(" ");
          const shortName = parts.length >= 2 ? `${parts[0]} ${parts[1][0]}.` : fullName;
          return {
            name: shortName,
            trips: p.completedTripsCount || 0,
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

      // Driver Status List for Dashboard Card
      const allApprovedProfiles = await DriverProfile.find({ approvalStatus: "APPROVED" }).limit(10).lean();
      const approvedUserIds = allApprovedProfiles.map((p: any) => p.userId);
      const approvedUsers = await User.find({ _id: { $in: approvedUserIds } }).select("name avatarUrl").lean();
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
          avatarUrl: u?.avatarUrl || "",
          vehicle: "Toyota Prius",
          status: statusStr,
          color,
        };
      });

      // Pending Ride Requests for Dashboard Card
      const pendingRideRequests = (pendingRideRequestsDocs || []).map((t: any) => {
        const id = t._id.toString();
        const shortId = id.substring(id.length - 8).toUpperCase();
        const passengerName = t.fullName || (t.passengerId as any)?.name || "Passenger";
        const initials = passengerName
          .split(" ")
          .map((n: string) => n[0])
          .join("")
          .toUpperCase()
          .substring(0, 2) || "PA";
        const avatarUrl = t.passengerAvatarUrl || (t.passengerId as any)?.avatarUrl || "";
        const pickup = t.pickupLocation?.address || t.streetAddress || "Pickup location";
        const destination = t.dropoffLocation?.address || t.destinationAddress || "Destination";

        let statusLabel = "Pending Review";
        if (t.status === "QUOTE_COUNTERED") statusLabel = "Counter Offer";
        else if (t.status === "QUOTE_SENT") statusLabel = "Quote Sent";

        const tripType = t.tripType || (t.schedule === "recurring" ? "recurring" : t.returnDate ? "round-trip" : "one-way");
        const fare = t.fare || t.quotedFare || t.counterOffer || null;
        const fareStr = fare ? `$${Number(fare).toFixed(2)}` : null;

        return {
          id,
          shortId,
          passenger: passengerName,
          initials,
          avatarUrl,
          pickup,
          destination,
          status: t.status,
          statusLabel,
          tripType,
          schedule: t.schedule || "one-time",
          fareStr,
          scheduledTime: t.scheduledTime || t.pickupTime || t.startDate || null,
          createdAt: t.createdAt,
        };
      });

      // Backwards compatible volume mapping
      const weeklyTripVolume = weekRidePerf.map((w) => ({
        date: w.label,
        total: w.requested,
        completed: w.completed,
      }));

      const monthlyTripVolume = monthRidePerf.map((m) => ({
        date: m.label,
        total: m.requested,
        completed: m.completed,
      }));

      const yearlyTripVolume = yearRidePerf.map((y) => ({
        date: y.label,
        total: y.requested,
        completed: y.completed,
      }));

      const monthlyRidePerformance = yearRidePerf.map((y) => ({
        month: y.label,
        requested: y.requested,
        completed: y.completed,
      }));

      const revenueOverview = {
        week: weekRidePerf.map((w) => ({ label: w.label, dateStr: w.dateStr, revenue: w.revenue, monthlyRevenue: w.revenue, outstanding: 0 })),
        fortnight: fortnightRidePerf.map((f) => ({ label: f.label, dateStr: f.dateStr, revenue: f.revenue, monthlyRevenue: f.revenue, outstanding: 0 })),
        month: monthRidePerf.map((m) => ({ label: m.label, revenue: m.revenue, monthlyRevenue: m.revenue, outstanding: 0 })),
        year: yearRidePerf.map((y) => ({ label: y.label, revenue: y.revenue, monthlyRevenue: y.revenue, outstanding: 0 })),
      };

      const ridePerformance = {
        week: weekRidePerf,
        fortnight: fortnightRidePerf,
        month: monthRidePerf,
        year: yearRidePerf,
      };

      res.status(200).json({
        success: true,
        data: {
          metrics: {
            todayTrips,
            totalTrips,
            totalRideRequests,
            completedTrips,
            pendingRequests,
            pendingTrips: pendingRequests,
            cancelledTrips,
            rejectedTrips,
            activeTrips,
            activeDrivers: activeDriversCount,
            onTripDrivers: onTripDriversCount,
            totalDrivers,
            totalPassengers,
            newPassengersThisWeek,
            totalRevenue,
            outstandingPayments: 0,
          },
          revenueSummary: {
            todayRevenue,
            weeklyRevenue,
            fortnightRevenue,
            monthlyRevenue,
            yearlyRevenue,
            outstandingBalance: 0,
            avgRidePrice,
          },
          ridePerformance,
          monthlyRidePerformance,
          revenueOverview,
          statusDistribution,
          weeklyTripVolume,
          monthlyTripVolume,
          yearlyTripVolume,
          driverStatus,
          pendingRideRequests,
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
      const availablePeriods = getFortnightlyPeriods(undefined, 20);
      const qStart = req.query.startDate as string;
      const qEnd = req.query.endDate as string;

      let activePeriod = availablePeriods[0];
      if (qStart && qEnd) {
        const found = availablePeriods.find((p) => p.startDate === qStart && p.endDate === qEnd);
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

      const filterStart = new Date(`${activePeriod.startDate}T00:00:00.000Z`);
      const filterEnd = new Date(`${activePeriod.endDate}T23:59:59.999Z`);

      // Fetch all driver profiles
      const profiles = await DriverProfile.find({ approvalStatus: "APPROVED" }).lean();
      const userIds = profiles.map((p: any) => p.userId);
      const users = await User.find({ _id: { $in: userIds } }).select("name email phone avatarUrl").lean();
      const userMap = new Map(users.map((u: any) => [u._id.toString(), u]));

      // Fetch completed trips and driver shifts in pay period in parallel
      const [tripAgg, shiftDocs] = await Promise.all([
        Trip.aggregate([
          {
            $match: {
              driverId: { $in: userIds },
              status: "COMPLETED",
              createdAt: { $gte: filterStart, $lte: filterEnd },
            },
          },
          {
            $group: {
              _id: "$driverId",
              completedCount: { $sum: 1 },
            },
          },
        ]),
        DriverShift.find({
          driverId: { $in: userIds },
          startedAt: { $gte: filterStart, $lte: filterEnd },
        }).lean(),
      ]);

      const tripCountMap = new Map(tripAgg.map((item: any) => [item._id.toString(), item.completedCount]));

      // Map total shift minutes per driver
      const shiftMinutesMap = new Map<string, number>();
      for (const s of shiftDocs) {
        const dId = s.driverId.toString();
        let mins = 0;
        if (s.totalMinutes !== undefined && s.totalMinutes !== null) {
          mins = s.totalMinutes;
        } else if (s.startedAt && s.endedAt) {
          mins = Math.max(0, Math.floor((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60000));
        } else if (s.startedAt && s.status === "IN_PROGRESS") {
          mins = Math.max(0, Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 60000));
        }
        shiftMinutesMap.set(dId, (shiftMinutesMap.get(dId) || 0) + mins);
      }

      const drivers = profiles.map((p: any) => {
        const uidStr = p.userId.toString();
        const u = userMap.get(uidStr);
        const name = u?.name || "Driver";
        const email = u?.email || "";
        const phone = u?.phone || "";

        const hourlyRate = p.hourlyRate ?? 14.0;
        const tripBonusRate = p.tripBonusRate ?? 3.0;

        // Driver clocked hours from Shift Logs
        const totalMins = shiftMinutesMap.get(uidStr) || 0;
        const clockedHours = Number((totalMins / 60).toFixed(2));

        const completedTrips = tripCountMap.get(uidStr) || p.completedTripsCount || 0;
        const tripBonus = Math.round((completedTrips * tripBonusRate) * 100) / 100;
        const regularWages = Math.round((hourlyRate * clockedHours) * 100) / 100;
        const grossEarnings = Math.round((regularWages + tripBonus) * 100) / 100;

        return {
          driverId: uidStr,
          name,
          email,
          phone,
          avatarUrl: u?.avatarUrl || p.avatarUrl || "",
          vehicle: p.vehicle ? `${p.vehicle.make || ""} ${p.vehicle.model || ""}`.trim() || "Unassigned" : "Unassigned",
          licensePlate: p.vehicle?.licensePlate || "N/A",
          hourlyRate,
          clockedHours,
          approvedHours: clockedHours, // for backwards compatibility
          tripBonusRate,
          completedTrips,
          tripBonus,
          regularWages,
          grossEarnings,
          payrollStatus: p.payrollStatus || "Approved",
        };
      });

      // Calculate summary totals across all drivers
      const totalPayroll = Math.round(drivers.reduce((sum: number, d: any) => sum + d.grossEarnings, 0) * 100) / 100;
      const avgHourlyRate = drivers.length > 0 ? (drivers.reduce((sum: number, d: any) => sum + d.hourlyRate, 0) / drivers.length) : 14.0;
      const totalClockedHours = Number(drivers.reduce((sum: number, d: any) => sum + d.clockedHours, 0).toFixed(2));

      res.status(200).json({
        success: true,
        data: {
          payPeriodRange: activePeriod.label,
          selectedPeriod: activePeriod,
          availablePeriods,
          summary: {
            totalPayroll,
            avgHourlyRate: Math.round(avgHourlyRate * 100) / 100,
            totalClockedHours,
            totalApprovedHours: totalClockedHours,
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

  async updateCrmContent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { crmContent } = req.body;
      if (!crmContent) {
        res.status(422).json({ success: false, error: { code: "VALIDATION_FAILED", message: "crmContent is required" } });
        return;
      }

      const cleanHtml = (raw: any): any => {
        if (typeof raw === "string") {
          return raw.replace(/&nbsp;/g, " ").replace(/\u00A0/g, " ");
        }
        if (typeof raw === "object" && raw !== null) {
          const resObj: any = {};
          for (const k of Object.keys(raw)) {
            resObj[k] = cleanHtml(raw[k]);
          }
          return resObj;
        }
        return raw;
      };

      const cleanedContent = cleanHtml(crmContent);

      const setting = await Setting.findOneAndUpdate(
        { key: "crmContent" },
        { value: JSON.stringify(cleanedContent) },
        { new: true, upsert: true }
      );

      res.status(200).json({
        success: true,
        data: JSON.parse(setting.value),
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

      // Helper to format date as YYYY-MM-DD using local year, month, date
      const toDateStr = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      };

      // Build 7 days headers array
      const weekDays: Array<{ day: string; date: string; dateStr: string; dayOfWeek: number }> = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(startOfWeek);
        d.setDate(d.getDate() + i);
        weekDays.push({
          day: dayHeaderNames[i],
          date: `${monthShortNames[d.getMonth()]} ${d.getDate()}`,
          dateStr: toDateStr(d),
          dayOfWeek: d.getDay(),
        });
      }

      // Query approved drivers and all shifts in current week
      const profiles = await DriverProfile.find({ approvalStatus: "APPROVED" }).lean();
      const userIds = profiles.map((p: any) => p.userId);
      const users = await User.find({ _id: { $in: userIds } }).select("name email phone avatarUrl").lean();
      const userMap = new Map(users.map((u: any) => [u._id.toString(), u]));

      const weekDateStrs = weekDays.map((w) => w.dateStr);
      const weekShifts = await DriverShift.find({
        driverId: { $in: userIds },
        $or: [
          { shiftDate: { $in: weekDateStrs } },
          { createdAt: { $gte: startOfWeek, $lte: endOfWeek } }
        ]
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

      const todayStr = toDateStr(todayStart);

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
          let isWorking = cfg ? cfg.working !== false : (wd.dayOfWeek >= 1 && wd.dayOfWeek <= 5);
          let startTimeStr = cfg?.startTime || "08:00 AM";
          let endTimeStr = cfg?.endTime || "04:00 PM";

          // Check if driver has a one-time change for this date
          const oneTimeChanges: any[] = p.oneTimeChanges || [];
          for (const ch of oneTimeChanges) {
            if (!ch?.date) continue;
            const chDate = getCentralTodayStr(new Date(ch.date));
            if (chDate === wd.dateStr) {
              isWorking = ch.working === true;
              if (ch.startTime) startTimeStr = ch.startTime;
              if (ch.endTime) endTimeStr = ch.endTime;
              break;
            }
          }

          const shiftKey = `${uidStr}_${wd.dateStr}`;
          const actualShift = shiftMap.get(shiftKey);

          let status = "SCHEDULED";
          let label = "Scheduled";
          let toneClass = "bg-amber-100 border-amber-300 text-amber-800"; // Scheduled: --color-amber-100
          let hoursText = `${startTimeStr} – ${endTimeStr}`;
          let workDuration = "—";

          // Parse scheduled start time Date for comparison using central time
          const scheduledStartDate = parseCentralDateTime(startTimeStr, wd.dateStr);

          if (!isWorking) {
            status = "DAY_OFF";
            label = "Day off";
            toneClass = "bg-slate-100 border-slate-200 text-slate-500"; // Day off: --color-slate-100
            hoursText = "Day off";
            workDuration = "—";
          } else {
            const duration = calculateShiftDuration(startTimeStr, endTimeStr);
            totalWeekMinutes += duration.minutes;
            workDuration = duration.text;

            if (actualShift && actualShift.startedAt) {
              const startedDate = new Date(actualShift.startedAt);
              const isLate = startedDate.getTime() > scheduledStartDate.getTime() + 15 * 60 * 1000; // 15m grace period

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
        const totalRemainingMins = totalWeekMinutes % 60;

        return {
          id: p._id.toString(),
          driverId: uidStr,
          name,
          email: u?.email || "",
          phone: u?.phone || "",
          initials,
          tone,
          total: `${totalHours}h ${String(totalRemainingMins).padStart(2, "0")}m`,
          avatarUrl,
          shifts,
          weeklySchedule: weeklyScheduleConfig,
        };
      });

      res.status(200).json({
        success: true,
        data: {
          weekStartStr: toDateStr(startOfWeek),
          weekEndStr: toDateStr(endOfWeek),
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

  async getUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const search = (req.query.search as string)?.trim() || "";
      const role = (req.query.role as string)?.trim();
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit as string, 10) || 50));

      const filter: any = {};
      if (role && role !== "ALL") {
        if (role === "PASSENGER") {
          filter.role = "USER";
        } else {
          filter.role = role.toUpperCase();
        }
      }

      if (search) {
        const regex = new RegExp(search, "i");
        filter.$or = [
          { name: regex },
          { email: regex },
          { phone: regex },
        ];
      }

      const [total, users, passengerCount, driverCount, adminCount, allTotal] = await Promise.all([
        User.countDocuments(filter),
        User.find(filter)
          .select("-passwordHash")
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        User.countDocuments({ role: "USER" }),
        User.countDocuments({ role: "DRIVER" }),
        User.countDocuments({ role: "ADMIN" }),
        User.countDocuments({}),
      ]);

      res.status(200).json({
        success: true,
        data: {
          users,
          total,
          page,
          totalPages: Math.ceil(total / limit) || 1,
          counts: {
            total: allTotal,
            passengers: passengerCount,
            drivers: driverCount,
            admins: adminCount,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, error: { code: "INVALID_ID", message: "Invalid user ID format" } });
        return;
      }

      const { name, email, phone, role, accountStatus } = req.body;

      const user = await User.findById(id);
      if (!user) {
        res.status(404).json({ success: false, error: { code: "USER_NOT_FOUND", message: "User not found" } });
        return;
      }

      if (email && email.toLowerCase() !== user.email.toLowerCase()) {
        const existingEmail = await User.findOne({
          email: email.toLowerCase().trim(),
          _id: { $ne: id },
        });
        if (existingEmail) {
          res.status(409).json({ success: false, error: { code: "EMAIL_EXISTS", message: "Email is already in use by another user" } });
          return;
        }
        user.email = email.toLowerCase().trim();
      }

      if (name !== undefined) user.name = name.trim();
      if (phone !== undefined) user.phone = phone.trim();
      if (accountStatus !== undefined) user.accountStatus = accountStatus;

      const oldRole = user.role;
      if (role && ["ADMIN", "DRIVER", "USER"].includes(role)) {
        user.role = role;
      }

      await user.save();

      // If role became DRIVER, ensure DriverProfile exists
      if (user.role === "DRIVER" && oldRole !== "DRIVER") {
        const existingProfile = await DriverProfile.findOne({ userId: user._id });
        if (!existingProfile) {
          await DriverProfile.create({
            userId: user._id,
            approvalStatus: "APPROVED",
            availabilityStatus: "OFFLINE",
            completedTripsCount: 0,
            hourlyRate: 20,
            approvedHours: 0,
            tripBonusRate: 5,
            payrollStatus: "PENDING",
            weeklySchedule: [
              { day: "Mon", working: false },
              { day: "Tue", working: false },
              { day: "Wed", working: false },
              { day: "Thu", working: false },
              { day: "Fri", working: false },
              { day: "Sat", working: false },
              { day: "Sun", working: false },
            ],
            oneTimeChanges: [],
          });
        }
      }

      const updatedUser = await User.findById(id).select("-passwordHash");
      res.status(200).json({
        success: true,
        data: updatedUser,
        message: "User updated successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, error: { code: "INVALID_ID", message: "Invalid user ID format" } });
        return;
      }

      const authUser = (req as any).user;
      if (authUser && (authUser._id?.toString() === id || authUser.id === id)) {
        res.status(400).json({
          success: false,
          error: { code: "CANNOT_DELETE_SELF", message: "You cannot delete your own admin account while logged in." },
        });
        return;
      }

      const user = await User.findById(id);
      if (!user) {
        res.status(404).json({ success: false, error: { code: "USER_NOT_FOUND", message: "User not found" } });
        return;
      }

      await User.findByIdAndDelete(id);
      await DriverProfile.deleteMany({ userId: id });

      res.status(200).json({
        success: true,
        message: "User permanently deleted",
      });
    } catch (error) {
      next(error);
    }
  }
}

export const adminController = new AdminController();
