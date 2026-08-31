import mongoose, { Document, Schema } from "mongoose";

export type DriverApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";
export type DriverAvailabilityStatus = "OFFLINE" | "ONLINE" | "ASSIGNED" | "UNAVAILABLE";

export interface IDaySchedule {
  day: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
  working: boolean;
  startTime?: string;
  endTime?: string;
}

export interface IOneTimeChange {
  date: Date;
  working: boolean;
  startTime?: string;
  endTime?: string;
  reason?: string;
}

export interface IDriverProfile extends Document {
  userId: mongoose.Types.ObjectId;
  licenseNumber?: string;
  licenseExpirationDate?: string;
  avatarUrl?: string;
  vehicle?: {
    make?: string;
    model?: string;
    year?: number;
    color?: string;
    licensePlate?: string;
  };
  approvalStatus: DriverApprovalStatus;
  availabilityStatus: DriverAvailabilityStatus;
  currentLocation?: {
    type: string;
    coordinates: [number, number]; // [longitude, latitude]
    updatedAt: Date;
  };
  completedTripsCount: number;
  hourlyRate: number;
  approvedHours: number;
  tripBonusRate: number;
  payrollStatus: string;
  weeklySchedule: IDaySchedule[];
  oneTimeChanges: IOneTimeChange[];
  createdAt: Date;
  updatedAt: Date;
}

const oneTimeChangeSchema = new Schema<IOneTimeChange>(
  {
    date: { type: Date, required: true },
    working: { type: Boolean, required: true },
    startTime: { type: String },
    endTime: { type: String },
    reason: { type: String },
  },
  { _id: true }
);

const dayScheduleSchema = new Schema<IDaySchedule>(
  {
    day: { type: String, enum: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], required: true },
    working: { type: Boolean, required: true },
    startTime: { type: String },
    endTime: { type: String },
  },
  { _id: false }
);

const driverProfileSchema = new Schema<IDriverProfile>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    licenseNumber: { type: String, trim: true },
    licenseExpirationDate: { type: String, trim: true },
    avatarUrl: { type: String, trim: true },
    vehicle: {
      make: { type: String, trim: true },
      model: { type: String, trim: true },
      year: { type: Number },
      color: { type: String, trim: true },
      licensePlate: { type: String, trim: true },
    },
    weeklySchedule: {
      type: [dayScheduleSchema],
      default: [
        { day: "Mon", working: true, startTime: "08:00 AM", endTime: "04:00 PM" },
        { day: "Tue", working: true, startTime: "08:00 AM", endTime: "04:00 PM" },
        { day: "Wed", working: true, startTime: "08:00 AM", endTime: "04:00 PM" },
        { day: "Thu", working: true, startTime: "08:00 AM", endTime: "04:00 PM" },
        { day: "Fri", working: true, startTime: "08:00 AM", endTime: "04:00 PM" },
        { day: "Sat", working: false },
        { day: "Sun", working: false },
      ],
    },
    oneTimeChanges: {
      type: [oneTimeChangeSchema],
      default: [],
    },
    approvalStatus: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "APPROVED",
      required: true,
    },
    availabilityStatus: {
      type: String,
      enum: ["OFFLINE", "ONLINE", "ASSIGNED", "UNAVAILABLE"],
      default: "OFFLINE",
      required: true,
      index: true,
    },
    currentLocation: {
      type: {
        type: String,
        enum: ["Point"],
      },
      coordinates: {
        type: [Number], // [lng, lat]
      },
      updatedAt: { type: Date },
    },
    completedTripsCount: { type: Number, default: 0 },
    hourlyRate: { type: Number, default: 14.0 },
    approvedHours: { type: Number, default: 80.0 },
    tripBonusRate: { type: Number, default: 3.0 },
    payrollStatus: { type: String, default: "Approved" },
  },
  {
    timestamps: true,
  }
);

driverProfileSchema.index({ "currentLocation": "2dsphere" });

export const DriverProfile = mongoose.model<IDriverProfile>("DriverProfile", driverProfileSchema);
