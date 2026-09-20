import { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { Trip } from "../../models/Trip.js";
import { User } from "../../models/User.js";
import { DriverProfile } from "../../models/DriverProfile.js";
import { Vehicle } from "../../models/Vehicle.js";
import { getCentralTodayStr, getCentralDayBounds } from "../../utils/dateUtils.js";

export class AdminAnalyticsController {
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

      const todayStr = getCentralTodayStr(now);
      const todayBounds = getCentralDayBounds(todayStr, now);

      // Past 7 days
      const weekStartStr = getCentralTodayStr(weekDays[0]);
      const weekBounds = getCentralDayBounds(weekStartStr, now);

      // Past 14 days
      const fortnightStartStr = getCentralTodayStr(fortnightDays[0]);
      const fortnightBounds = getCentralDayBounds(fortnightStartStr, now);

      // Current month bounds
      const monthStartStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const monthEndStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(lastDayOfMonth).padStart(2, "0")}`;

      // Current year bounds
      const yearStartStr = `${now.getFullYear()}-01-01`;
      const yearEndStr = `${now.getFullYear()}-12-31`;

      const buildTripPeriodFilter = (startStr: string, endStr: string, startUtc: Date, endUtc: Date) => ({
        ...actualTripMatch,
        $or: [
          { pickupDate: { $gte: startStr, $lte: endStr } },
          {
            $and: [
              { $or: [{ pickupDate: { $exists: false } }, { pickupDate: null }, { pickupDate: "" }] },
              { startDate: { $gte: startStr, $lte: endStr } },
            ],
          },
          {
            $and: [
              { $or: [{ pickupDate: { $exists: false } }, { pickupDate: null }, { pickupDate: "" }] },
              { $or: [{ startDate: { $exists: false } }, { startDate: null }, { startDate: "" }] },
              { createdAt: { $gte: startUtc, $lte: endUtc } },
            ],
          },
        ],
      });

      const buildCompletedPeriodFilter = (startStr: string, endStr: string, startUtc: Date, endUtc: Date) => ({
        ...actualTripMatch,
        status: "COMPLETED",
        $or: [
          { pickupDate: { $gte: startStr, $lte: endStr } },
          {
            $and: [
              { $or: [{ pickupDate: { $exists: false } }, { pickupDate: null }, { pickupDate: "" }] },
              { startDate: { $gte: startStr, $lte: endStr } },
            ],
          },
          { completedAt: { $gte: startUtc, $lte: endUtc } },
          {
            $and: [
              { $or: [{ completedAt: { $exists: false } }, { completedAt: null }] },
              { updatedAt: { $gte: startUtc, $lte: endUtc } },
            ],
          },
        ],
      });

      const buildPendingPeriodFilter = (startStr: string, endStr: string, startUtc: Date, endUtc: Date) => ({
        parentRequestId: { $exists: false },
        status: { $in: ["REQUESTED", "QUOTE_COUNTERED", "QUOTE_SENT"] },
        $or: [
          { pickupDate: { $gte: startStr, $lte: endStr } },
          {
            $and: [
              { $or: [{ pickupDate: { $exists: false } }, { pickupDate: null }, { pickupDate: "" }] },
              { startDate: { $gte: startStr, $lte: endStr } },
            ],
          },
          { createdAt: { $gte: startUtc, $lte: endUtc } },
        ],
      });

      // Run parallel aggregations for metrics and multi-period datasets
      const [
        todayTripsCount,
        weekTripsCount,
        fortnightTripsCount,
        monthTripsCount,
        yearTripsCount,

        todayCompletedCount,
        weekCompletedCount,
        fortnightCompletedCount,
        monthCompletedCount,
        yearCompletedCount,

        todayPendingCount,
        weekPendingCount,
        fortnightPendingCount,
        monthPendingCount,
        yearPendingCount,

        todayDriversWithTrips,
        weekDriversWithTrips,
        fortnightDriversWithTrips,
        monthDriversWithTrips,
        yearDriversWithTrips,

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
        Trip.countDocuments(buildTripPeriodFilter(todayStr, todayStr, todayBounds.start, todayBounds.end)),
        Trip.countDocuments(buildTripPeriodFilter(weekStartStr, todayStr, weekBounds.start, todayBounds.end)),
        Trip.countDocuments(buildTripPeriodFilter(fortnightStartStr, todayStr, fortnightBounds.start, todayBounds.end)),
        Trip.countDocuments(buildTripPeriodFilter(monthStartStr, monthEndStr, startOfMonth, endOfMonth)),
        Trip.countDocuments(buildTripPeriodFilter(yearStartStr, yearEndStr, startOfYear, endOfYear)),

        Trip.countDocuments(buildCompletedPeriodFilter(todayStr, todayStr, todayBounds.start, todayBounds.end)),
        Trip.countDocuments(buildCompletedPeriodFilter(weekStartStr, todayStr, weekBounds.start, todayBounds.end)),
        Trip.countDocuments(buildCompletedPeriodFilter(fortnightStartStr, todayStr, fortnightBounds.start, todayBounds.end)),
        Trip.countDocuments(buildCompletedPeriodFilter(monthStartStr, monthEndStr, startOfMonth, endOfMonth)),
        Trip.countDocuments(buildCompletedPeriodFilter(yearStartStr, yearEndStr, startOfYear, endOfYear)),

        Trip.countDocuments(buildPendingPeriodFilter(todayStr, todayStr, todayBounds.start, todayBounds.end)),
        Trip.countDocuments(buildPendingPeriodFilter(weekStartStr, todayStr, weekBounds.start, todayBounds.end)),
        Trip.countDocuments(buildPendingPeriodFilter(fortnightStartStr, todayStr, fortnightBounds.start, todayBounds.end)),
        Trip.countDocuments(buildPendingPeriodFilter(monthStartStr, monthEndStr, startOfMonth, endOfMonth)),
        Trip.countDocuments(buildPendingPeriodFilter(yearStartStr, yearEndStr, startOfYear, endOfYear)),

        Trip.distinct("driverId", { ...buildTripPeriodFilter(todayStr, todayStr, todayBounds.start, todayBounds.end), driverId: { $ne: null } }),
        Trip.distinct("driverId", { ...buildTripPeriodFilter(weekStartStr, todayStr, weekBounds.start, todayBounds.end), driverId: { $ne: null } }),
        Trip.distinct("driverId", { ...buildTripPeriodFilter(fortnightStartStr, todayStr, fortnightBounds.start, todayBounds.end), driverId: { $ne: null } }),
        Trip.distinct("driverId", { ...buildTripPeriodFilter(monthStartStr, monthEndStr, startOfMonth, endOfMonth), driverId: { $ne: null } }),
        Trip.distinct("driverId", { ...buildTripPeriodFilter(yearStartStr, yearEndStr, startOfYear, endOfYear), driverId: { $ne: null } }),

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
                    {
                      $and: [
                        { $gte: [{ $convert: { input: { $ifNull: ["$completedAt", { $ifNull: ["$scheduledTime", "$createdAt"] }] }, to: "date", onError: "$createdAt", onNull: "$createdAt" } }, todayBounds.start] },
                        { $lte: [{ $convert: { input: { $ifNull: ["$completedAt", { $ifNull: ["$scheduledTime", "$createdAt"] }] }, to: "date", onError: "$createdAt", onNull: "$createdAt" } }, todayBounds.end] },
                      ],
                    },
                    { $ifNull: ["$fare", { $ifNull: ["$quotedFare", 0] }] },
                    0,
                  ],
                },
              },
              weeklyRevenue: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $gte: [{ $convert: { input: { $ifNull: ["$completedAt", { $ifNull: ["$scheduledTime", "$createdAt"] }] }, to: "date", onError: "$createdAt", onNull: "$createdAt" } }, weekBounds.start] },
                        { $lte: [{ $convert: { input: { $ifNull: ["$completedAt", { $ifNull: ["$scheduledTime", "$createdAt"] }] }, to: "date", onError: "$createdAt", onNull: "$createdAt" } }, todayBounds.end] },
                      ],
                    },
                    { $ifNull: ["$fare", { $ifNull: ["$quotedFare", 0] }] },
                    0,
                  ],
                },
              },
              fortnightRevenue: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $gte: [{ $convert: { input: { $ifNull: ["$completedAt", { $ifNull: ["$scheduledTime", "$createdAt"] }] }, to: "date", onError: "$createdAt", onNull: "$createdAt" } }, fortnightBounds.start] },
                        { $lte: [{ $convert: { input: { $ifNull: ["$completedAt", { $ifNull: ["$scheduledTime", "$createdAt"] }] }, to: "date", onError: "$createdAt", onNull: "$createdAt" } }, todayBounds.end] },
                      ],
                    },
                    { $ifNull: ["$fare", { $ifNull: ["$quotedFare", 0] }] },
                    0,
                  ],
                },
              },
              monthlyRevenue: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $gte: [{ $convert: { input: { $ifNull: ["$completedAt", { $ifNull: ["$scheduledTime", "$createdAt"] }] }, to: "date", onError: "$createdAt", onNull: "$createdAt" } }, startOfMonth] },
                        { $lte: [{ $convert: { input: { $ifNull: ["$completedAt", { $ifNull: ["$scheduledTime", "$createdAt"] }] }, to: "date", onError: "$createdAt", onNull: "$createdAt" } }, endOfMonth] },
                      ],
                    },
                    { $ifNull: ["$fare", { $ifNull: ["$quotedFare", 0] }] },
                    0,
                  ],
                },
              },
              yearlyRevenue: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $gte: [{ $convert: { input: { $ifNull: ["$completedAt", { $ifNull: ["$scheduledTime", "$createdAt"] }] }, to: "date", onError: "$createdAt", onNull: "$createdAt" } }, startOfYear] },
                        { $lte: [{ $convert: { input: { $ifNull: ["$completedAt", { $ifNull: ["$scheduledTime", "$createdAt"] }] }, to: "date", onError: "$createdAt", onNull: "$createdAt" } }, endOfYear] },
                      ],
                    },
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

      // Fetch vehicles to map driver assignments accurately
      const allVehicles = await Vehicle.find().lean();
      const vehicleByIdMap = new Map(allVehicles.map((v: any) => [v._id.toString(), v]));
      const vehicleByDriverMap = new Map(
        allVehicles
          .filter((v: any) => v.assignedDriverId)
          .map((v: any) => [v.assignedDriverId.toString(), v])
      );

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

        const assignedVeh = p.vehicleId
          ? vehicleByIdMap.get(p.vehicleId.toString())
          : vehicleByDriverMap.get(uidStr);
        const vehicleName =
          assignedVeh?.modelName?.trim() ||
          p.vehicle?.model?.trim() ||
          "No vehicle assigned";

        return {
          id: uidStr,
          initials,
          name,
          avatarUrl: u?.avatarUrl || "",
          vehicle: vehicleName,
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

      const periodMetrics = {
        today: {
          totalTrips: todayTripsCount,
          completedTrips: todayCompletedCount,
          pendingRequests: todayPendingCount,
          activeDrivers: Math.max(activeDriversCount, todayDriversWithTrips.length),
          dateRangeLabel: "Today",
        },
        week: {
          totalTrips: weekTripsCount,
          completedTrips: weekCompletedCount,
          pendingRequests: weekPendingCount,
          activeDrivers: Math.max(activeDriversCount, weekDriversWithTrips.length),
          dateRangeLabel: "Past 7 Days",
        },
        fortnight: {
          totalTrips: fortnightTripsCount,
          completedTrips: fortnightCompletedCount,
          pendingRequests: fortnightPendingCount,
          activeDrivers: Math.max(activeDriversCount, fortnightDriversWithTrips.length),
          dateRangeLabel: "Past 14 Days",
        },
        month: {
          totalTrips: monthTripsCount,
          completedTrips: monthCompletedCount,
          pendingRequests: monthPendingCount,
          activeDrivers: Math.max(activeDriversCount, monthDriversWithTrips.length),
          dateRangeLabel: "This Month",
        },
        year: {
          totalTrips: yearTripsCount,
          completedTrips: yearCompletedCount,
          pendingRequests: yearPendingCount,
          activeDrivers: Math.max(activeDriversCount, yearDriversWithTrips.length),
          dateRangeLabel: "This Year",
        },
      };

      res.status(200).json({
        success: true,
        data: {
          metrics: {
            todayTrips: todayTripsCount,
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
            periodMetrics,
          },
          periodMetrics,
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
}

export const adminAnalyticsController = new AdminAnalyticsController();
