import { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { DriverProfile } from "../../models/DriverProfile.js";
import { User } from "../../models/User.js";
import { Trip } from "../../models/Trip.js";
import { Vehicle } from "../../models/Vehicle.js";
import { DriverShift } from "../../models/DriverShift.js";
import { AuditLog } from "../../models/AuditLog.js";
import { getFortnightlyPeriods } from "../driverController.js";
import { parseCentralDateTime, calculateShiftDuration, getCentralTodayStr, getCentralDayBounds } from "../../utils/dateUtils.js";
import { syncDriverProfileWithApplication, resolveDriverProfile } from "./adminDriverUtils.js";

const updateDriverStatusSchema = z.object({
  approvalStatus: z.enum(["APPROVED", "REJECTED"]).optional(),
  accountStatus: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});


export class AdminDriverController {
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

      const startBounds = getCentralDayBounds(activePeriod.startDate);
      const endBounds = getCentralDayBounds(activePeriod.endDate);
      const filterStart = startBounds.start;
      const filterEnd = endBounds.end;

      // Exclude parent container requests whose child legs exist to avoid duplicate entries
      const parentIdsWithChildren = await Trip.find({
        parentRequestId: { $exists: true, $ne: null },
      }).distinct("parentRequestId");

      const [trips, shifts] = await Promise.all([
        Trip.find({
          driverId: user._id,
          _id: { $nin: parentIdsWithChildren },
          $or: [
            { completedAt: { $gte: filterStart, $lte: filterEnd } },
            { scheduledTime: { $gte: filterStart, $lte: filterEnd } },
            { pickupDate: { $gte: activePeriod.startDate, $lte: activePeriod.endDate } },
            { createdAt: { $gte: filterStart, $lte: filterEnd } },
          ],
        })
          .select("_id status fare pickupLocation dropoffLocation fullName passengerId pickupDate pickupTime scheduledTime completedAt createdAt")
          .populate("passengerId", "name")
          .sort({ completedAt: -1, scheduledTime: -1, createdAt: -1 })
          .lean(),
        DriverShift.find({
          driverId: user._id,
          $or: [
            { startedAt: { $gte: filterStart, $lte: filterEnd } },
            { endedAt: { $gte: filterStart, $lte: filterEnd } },
          ],
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
                vehicleId: profile.vehicleId ? profile.vehicleId.toString() : null,
                approvalStatus: profile.approvalStatus,
                availabilityStatus: profile.availabilityStatus,
                completedTripsCount: profile.completedTripsCount,
                weeklySchedule: profile.weeklySchedule || null,
                oneTimeChanges: profile.oneTimeChanges || [],
              }
            : null,
          trips: completedTrips.map((t) => ({
            _id: t._id.toString(),
            status: t.status,
            fare: t.fare ?? null,
            pickup: t.pickupLocation?.address || null,
            dropoff: t.dropoffLocation?.address || null,
            passengerName: t.fullName || (t.passengerId as any)?.name || null,
            pickupDate: t.pickupDate || null,
            pickupTime: t.pickupTime || null,
            scheduledTime: t.scheduledTime || null,
            completedAt: t.completedAt || null,
            createdAt: t.createdAt,
          })),
          completedTrips: completedTrips.map((t) => ({
            _id: t._id.toString(),
            status: t.status,
            fare: t.fare ?? null,
            pickup: t.pickupLocation?.address || null,
            dropoff: t.dropoffLocation?.address || null,
            passengerName: t.fullName || (t.passengerId as any)?.name || null,
            pickupDate: t.pickupDate || null,
            pickupTime: t.pickupTime || null,
            scheduledTime: t.scheduledTime || null,
            completedAt: t.completedAt || null,
            createdAt: t.createdAt,
          })),
          allTrips: trips.map((t) => ({
            _id: t._id.toString(),
            status: t.status,
            fare: t.fare ?? null,
            pickup: t.pickupLocation?.address || null,
            dropoff: t.dropoffLocation?.address || null,
            passengerName: t.fullName || (t.passengerId as any)?.name || null,
            pickupDate: t.pickupDate || null,
            pickupTime: t.pickupTime || null,
            scheduledTime: t.scheduledTime || null,
            completedAt: t.completedAt || null,
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

      // Current fortnightly period for calculating actual completed trips
      const currentFortnight = getFortnightlyPeriods()[0];
      const fnStart = new Date(`${currentFortnight.startDate}T00:00:00.000Z`);
      const fnEnd = new Date(`${currentFortnight.endDate}T23:59:59.999Z`);
      const driverIds = driverUsers.map((u) => u._id);

      const [fortnightCompletedAgg, totalCompletedAgg] = await Promise.all([
        Trip.aggregate([
          {
            $match: {
              driverId: { $in: driverIds },
              status: "COMPLETED",
              createdAt: { $gte: fnStart, $lte: fnEnd },
            },
          },
          {
            $group: {
              _id: "$driverId",
              count: { $sum: 1 },
            },
          },
        ]),
        Trip.aggregate([
          {
            $match: {
              driverId: { $in: driverIds },
              status: "COMPLETED",
            },
          },
          {
            $group: {
              _id: "$driverId",
              count: { $sum: 1 },
            },
          },
        ]),
      ]);

      const fnCountMap = new Map<string, number>(
        fortnightCompletedAgg.map((item: any) => [item._id.toString(), item.count])
      );
      const totalCountMap = new Map<string, number>(
        totalCompletedAgg.map((item: any) => [item._id.toString(), item.count])
      );

      const drivers = await Promise.all(
        driverUsers.map(async (u) => {
          const p = await syncDriverProfileWithApplication(u);
          const fnTrips = fnCountMap.get(u._id.toString()) || 0;
          const totalTrips = totalCountMap.get(u._id.toString()) || 0;

          if (p && p.completedTripsCount !== totalTrips) {
            p.completedTripsCount = totalTrips;
            await p.save();
          }

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
                  vehicleId: p.vehicleId ? p.vehicleId.toString() : null,
                  licenseNumber: p.licenseNumber || null,
                  licenseExpirationDate: p.licenseExpirationDate || null,
                  completedTripsCount: fnTrips,
                  fortnightCompletedTripsCount: fnTrips,
                  totalCompletedTripsCount: totalTrips,
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

      const { name, phone, email, licenseNumber, licenseExpirationDate, vehicleId, avatarUrl } = req.body;

      const driverUser = await User.findOne({ _id: id, role: "DRIVER" });
      if (!driverUser) {
        res.status(404).json({ success: false, error: { code: "DRIVER_NOT_FOUND", message: "Driver not found" } });
        return;
      }

      // Update User fields
      if (name !== undefined) driverUser.name = name;
      if (phone !== undefined) driverUser.phone = phone;
      if (email !== undefined) driverUser.email = email.toLowerCase();
      if (avatarUrl !== undefined) driverUser.avatarUrl = avatarUrl;
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
      if (avatarUrl !== undefined) profile.avatarUrl = driverUser.avatarUrl || avatarUrl;

      // Handle vehicle assignment
      if (vehicleId !== undefined) {
        if (vehicleId && vehicleId !== "none" && mongoose.Types.ObjectId.isValid(vehicleId)) {
          const selectedVehicle = await Vehicle.findById(vehicleId);
          if (selectedVehicle) {
            // Unassign other vehicles previously assigned to this driver
            await Vehicle.updateMany(
              { assignedDriverId: driverUser._id, _id: { $ne: selectedVehicle._id } },
              { $unset: { assignedDriverId: 1 } }
            );

            // Assign this vehicle to driver
            selectedVehicle.assignedDriverId = driverUser._id as any;
            await selectedVehicle.save();

            profile.vehicleId = selectedVehicle._id as any;
            profile.vehicle = {
              model: selectedVehicle.modelName,
              year: selectedVehicle.year,
              licensePlate: selectedVehicle.licensePlate,
            };
          }
        } else if (!vehicleId || vehicleId === "none") {
          profile.vehicleId = undefined;
          profile.vehicle = undefined;
          await Vehicle.updateMany(
            { assignedDriverId: driverUser._id },
            { $unset: { assignedDriverId: 1 } }
          );
        }
      }

      await profile.save();

      res.status(200).json({
        success: true,
        message: "Driver profile updated successfully",
        data: {
          id: driverUser._id.toString(),
          name: driverUser.name,
          phone: driverUser.phone,
          email: driverUser.email,
          avatarUrl: driverUser.avatarUrl || profile.avatarUrl || "",
          profile: {
            licenseNumber: profile.licenseNumber,
            licenseExpirationDate: profile.licenseExpirationDate,
            approvalStatus: profile.approvalStatus,
            availabilityStatus: profile.availabilityStatus,
            avatarUrl: profile.avatarUrl || driverUser.avatarUrl || "",
            vehicle: profile.vehicle || null,
            vehicleId: profile.vehicleId ? profile.vehicleId.toString() : null,
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
}

export const adminDriverController = new AdminDriverController();
