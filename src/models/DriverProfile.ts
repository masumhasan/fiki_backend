import mongoose, { Document, Schema } from "mongoose";

export type DriverApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";
export type DriverAvailabilityStatus = "OFFLINE" | "ONLINE" | "ASSIGNED" | "UNAVAILABLE";

export interface IDriverProfile extends Document {
  userId: mongoose.Types.ObjectId;
  licenseNumber?: string;
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
  rating?: number;
  completedTripsCount: number;
  createdAt: Date;
  updatedAt: Date;
}

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
    vehicle: {
      make: { type: String, trim: true },
      model: { type: String, trim: true },
      year: { type: Number },
      color: { type: String, trim: true },
      licensePlate: { type: String, trim: true },
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
    rating: { type: Number, default: 5.0 },
    completedTripsCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

driverProfileSchema.index({ "currentLocation": "2dsphere" });

export const DriverProfile = mongoose.model<IDriverProfile>("DriverProfile", driverProfileSchema);
