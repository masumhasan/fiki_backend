import mongoose, { Document, Schema } from "mongoose";

export type ShiftStatus = "IN_PROGRESS" | "COMPLETED";

export interface IDriverShift extends Document {
  driverId: mongoose.Types.ObjectId;
  shiftDate: string; // YYYY-MM-DD
  status: ShiftStatus;
  startedAt: Date;
  endedAt?: Date;
  autoEnded?: boolean;
  pendingEndReport?: boolean;
  totalMinutes?: number;
  totalHoursText?: string; // e.g. "8h 04m"
  startingOdometer: number;
  endingOdometer?: number;
  estimatedMiles?: number; // endingOdometer - startingOdometer
  startFuel: string; // empty | quarter | half | three-quarters | full
  endFuel?: string;
  startCondition: string; // clear | maintenance | damage | cleaned
  endCondition?: string;
  startNotes?: string;
  endNotes?: string;
  startPhotoUrl?: string;
  endPhotoUrl?: string;
  startPhotoUrls?: string[];
  endPhotoUrls?: string[];
  vehicleInfo?: {
    make?: string;
    model?: string;
    year?: number;
    licensePlate?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const driverShiftSchema = new Schema<IDriverShift>(
  {
    driverId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    shiftDate: {
      type: String,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["IN_PROGRESS", "COMPLETED"],
      default: "IN_PROGRESS",
    },
    startedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    endedAt: {
      type: Date,
    },
    autoEnded: {
      type: Boolean,
      default: false,
    },
    pendingEndReport: {
      type: Boolean,
      default: false,
    },
    totalMinutes: {
      type: Number,
    },
    totalHoursText: {
      type: String,
    },
    startingOdometer: {
      type: Number,
      required: true,
    },
    endingOdometer: {
      type: Number,
    },
    estimatedMiles: {
      type: Number,
    },
    startFuel: {
      type: String,
      required: true,
      enum: ["empty", "quarter", "half", "three-quarters", "full"],
      default: "half",
    },
    endFuel: {
      type: String,
      enum: ["empty", "quarter", "half", "three-quarters", "full"],
    },
    startCondition: {
      type: String,
      required: true,
      enum: ["clear", "maintenance", "damage", "cleaned"],
      default: "clear",
    },
    endCondition: {
      type: String,
      enum: ["clear", "maintenance", "damage", "cleaned"],
    },
    startNotes: {
      type: String,
      maxlength: 300,
    },
    endNotes: {
      type: String,
      maxlength: 300,
    },
    startPhotoUrl: {
      type: String,
    },
    endPhotoUrl: {
      type: String,
    },
    startPhotoUrls: {
      type: [String],
      default: [],
    },
    endPhotoUrls: {
      type: [String],
      default: [],
    },
    vehicleInfo: {
      make: String,
      model: String,
      year: Number,
      licensePlate: String,
    },
  },
  {
    timestamps: true,
  }
);

export const DriverShift = mongoose.model<IDriverShift>("DriverShift", driverShiftSchema);
