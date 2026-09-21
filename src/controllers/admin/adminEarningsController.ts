import { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { DriverProfile } from "../../models/DriverProfile.js";
import { User } from "../../models/User.js";
import { Trip } from "../../models/Trip.js";
import { DriverShift } from "../../models/DriverShift.js";
import { getFortnightlyPeriods } from "../driverController.js";
import { getCentralDayBounds } from "../../utils/dateUtils.js";
import { resolveDriverProfile } from "./adminDriverUtils.js";

export class AdminEarningsController {
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

      const startBounds = getCentralDayBounds(activePeriod.startDate);
      const endBounds = getCentralDayBounds(activePeriod.endDate);
      const filterStart = startBounds.start;
      const filterEnd = endBounds.end;

      // Fetch all driver profiles
      const profiles = await DriverProfile.find({ approvalStatus: "APPROVED" }).lean();
      const userIds = profiles.map((p: any) => p.userId);
      const users = await User.find({ _id: { $in: userIds } }).select("name email phone avatarUrl").lean();
      const userMap = new Map(users.map((u: any) => [u._id.toString(), u]));

      // Exclude parent container requests whose child legs exist to avoid double-counting
      const parentIdsWithChildren = await Trip.find({
        parentRequestId: { $exists: true, $ne: null },
      }).distinct("parentRequestId");

      // Fetch completed trips and driver shifts in pay period in parallel
      const [tripAgg, shiftDocs] = await Promise.all([
        Trip.aggregate([
          {
            $match: {
              driverId: { $in: userIds },
              status: "COMPLETED",
              _id: { $nin: parentIdsWithChildren },
              $or: [
                { completedAt: { $gte: filterStart, $lte: filterEnd } },
                { scheduledTime: { $gte: filterStart, $lte: filterEnd } },
                { pickupDate: { $gte: activePeriod.startDate, $lte: activePeriod.endDate } },
                { createdAt: { $gte: filterStart, $lte: filterEnd } },
              ],
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
}

export const adminEarningsController = new AdminEarningsController();
