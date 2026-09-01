import mongoose from "mongoose";
import { Trip } from "../models/Trip.js";
import { parseCentralDateTime } from "./dateUtils.js";

export async function generateRecurringTripsForMaster(masterTrip: any) {
  if (!masterTrip || !masterTrip._id) return;

  const isRecurring =
    masterTrip.schedule === "recurring" ||
    masterTrip.tripType === "recurring" ||
    (Array.isArray(masterTrip.recurringDays) && masterTrip.recurringDays.length > 0);

  if (!isRecurring) return;

  const startDateStr = masterTrip.startDate || masterTrip.pickupDate || masterTrip.recurringStartDate;
  const endDateStr = masterTrip.endDate || masterTrip.returnDate || masterTrip.recurringEndDate || startDateStr;

  if (!startDateStr) return;

  const recurringDaysInput = Array.isArray(masterTrip.recurringDays) && masterTrip.recurringDays.length > 0
    ? masterTrip.recurringDays.map((d: string) => String(d).trim().toLowerCase())
    : [];

  const isRoundTrip =
    masterTrip.tripType === "round-trip" ||
    masterTrip.tripType === "round_trip" ||
    masterTrip.isRoundTrip === true;

  const parseDateParts = (str: any): { year: number; month: number; day: number } | null => {
    if (!str) return null;
    const raw = String(str).trim();

    // 1. If string starts with YYYY-MM-DD
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    if (match) {
      return {
        year: parseInt(match[1], 10),
        month: parseInt(match[2], 10),
        day: parseInt(match[3], 10),
      };
    }

    // 2. Fallback: Parse date using America/Chicago timezone
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;

    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);

    const year = parseInt(parts.find((p) => p.type === "year")?.value || "0", 10);
    const month = parseInt(parts.find((p) => p.type === "month")?.value || "0", 10);
    const day = parseInt(parts.find((p) => p.type === "day")?.value || "0", 10);

    if (!year || !month || !day) return null;
    return { year, month, day };
  };

  const startParts = parseDateParts(startDateStr);
  const endParts = parseDateParts(endDateStr);

  if (!startParts || !endParts) return;

  // Delete all old uncompleted child trips for this master request before recreating
  await Trip.deleteMany({
    parentRequestId: masterTrip._id,
    status: { $nin: ["COMPLETED", "IN_PROGRESS", "DRIVER_ARRIVED"] },
  });

  const dayMap: Record<number, string[]> = {
    0: ["sunday", "sun"],
    1: ["monday", "mon"],
    2: ["tuesday", "tue"],
    3: ["wednesday", "wed"],
    4: ["thursday", "thu"],
    5: ["friday", "fri"],
    6: ["saturday", "sat"],
  };

  const childDocs: any[] = [];
  let currentUtc = new Date(Date.UTC(startParts.year, startParts.month - 1, startParts.day));
  const endUtc = new Date(Date.UTC(endParts.year, endParts.month - 1, endParts.day));

  // Fetch dates that already have completed or in-progress trips for this parent request to avoid duplicate generation
  const existingCompletedOrActiveTrips = await Trip.find({
    parentRequestId: masterTrip._id,
    status: { $in: ["COMPLETED", "IN_PROGRESS", "DRIVER_ARRIVED"] },
  }).select("pickupDate isReturnLeg").lean();

  const completedKeySet = new Set(
    existingCompletedOrActiveTrips.map((t) => `${t.pickupDate}_${Boolean(t.isReturnLeg)}`)
  );

  while (currentUtc <= endUtc) {
    const year = currentUtc.getUTCFullYear();
    const month = String(currentUtc.getUTCMonth() + 1).padStart(2, "0");
    const day = String(currentUtc.getUTCDate()).padStart(2, "0");
    const dateIsoStr = `${year}-${month}-${day}`;

    const dayOfWeek = currentUtc.getUTCDay();
    const dayKeywords = dayMap[dayOfWeek] || [];

    const matchesDay =
      recurringDaysInput.length === 0 ||
      recurringDaysInput.some((userDay: string) => {
        return dayKeywords.some((kw) => userDay.toLowerCase() === kw || userDay.toLowerCase().startsWith(kw));
      });

    if (matchesDay) {
      const outboundPickupTime = masterTrip.pickupTime || masterTrip.recurringPickupTime || "08:00 AM";
      const outboundScheduledTime = parseCentralDateTime(outboundPickupTime, dateIsoStr);

      const masterId = new mongoose.Types.ObjectId(masterTrip._id.toString());
      const passengerId = masterTrip.passengerId
        ? new mongoose.Types.ObjectId((masterTrip.passengerId._id || masterTrip.passengerId).toString())
        : undefined;
      const driverId = masterTrip.driverId
        ? new mongoose.Types.ObjectId((masterTrip.driverId._id || masterTrip.driverId).toString())
        : undefined;

      const baseFields = {
        parentRequestId: masterId,
        passengerId,
        driverId,
        status: driverId ? "ACCEPTED" : (masterTrip.status || "REQUESTED"),
        assignedAt: masterTrip.assignedAt,
        acceptedAt: masterTrip.acceptedAt,
        fare: masterTrip.fare,
        quotedFare: masterTrip.quotedFare,
        fullName: masterTrip.fullName,
        phoneNumber: masterTrip.phoneNumber,
        email: masterTrip.email,
        dateOfBirth: masterTrip.dateOfBirth,
        emergencyContactName: masterTrip.emergencyContactName,
        emergencyContactPhone: masterTrip.emergencyContactPhone,
        relationship: masterTrip.relationship,
        schedule: "recurring",
        recurringDays: masterTrip.recurringDays,
        startDate: startDateStr,
        endDate: endDateStr,
        mobilityOptions: masterTrip.mobilityOptions,
        specialInstructions: masterTrip.specialInstructions,
        accessInformation: masterTrip.accessInformation,
        driverNotes: masterTrip.driverNotes,
        insuranceName: masterTrip.insuranceName,
        authNumber: masterTrip.authNumber,
        privatePay: masterTrip.privatePay,
        requestSource: masterTrip.requestSource,
      };

      // 1. Outbound Leg (if not already completed/active)
      if (!completedKeySet.has(`${dateIsoStr}_false`)) {
        childDocs.push({
          ...baseFields,
          tripType: isRoundTrip ? "round-trip" : (masterTrip.tripType || "one-way"),
          isReturnLeg: false,
          legType: "OUTBOUND",
          pickupDate: dateIsoStr,
          pickupTime: outboundPickupTime,
          scheduledTime: outboundScheduledTime,
          pickupLocation: masterTrip.pickupLocation,
          dropoffLocation: masterTrip.dropoffLocation,
        });
      }

      // 2. Return Leg (If Round-Trip and not already completed/active)
      if (isRoundTrip && !completedKeySet.has(`${dateIsoStr}_true`)) {
        const returnTime = masterTrip.returnPickupTime || "05:00 PM";
        const returnScheduledTime = parseCentralDateTime(returnTime, dateIsoStr);
        const returnPickupAddr = masterTrip.returnPickupAddress || masterTrip.dropoffLocation?.address || masterTrip.pickupLocation?.address;
        const returnDropoffAddr = masterTrip.returnDestinationAddress || masterTrip.pickupLocation?.address || masterTrip.dropoffLocation?.address;

        childDocs.push({
          ...baseFields,
          tripType: "round-trip",
          isReturnLeg: true,
          legType: "RETURN",
          pickupDate: dateIsoStr,
          pickupTime: returnTime,
          scheduledTime: returnScheduledTime,
          returnPickupTime: returnTime,
          returnPickupAddress: returnPickupAddr,
          returnDestinationAddress: returnDropoffAddr,
          pickupLocation: { address: returnPickupAddr },
          dropoffLocation: { address: returnDropoffAddr },
        });
      }
    }

    currentUtc.setUTCDate(currentUtc.getUTCDate() + 1);
  }

  if (childDocs.length > 0) {
    await Trip.insertMany(childDocs);
  }
}
