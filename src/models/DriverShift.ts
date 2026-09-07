import mongoose, { Document, Schema } from "mongoose";
import { ensureS3Image } from "../utils/imageHelper.js";

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

driverShiftSchema.index({ driverId: 1, status: 1 });
driverShiftSchema.index({ driverId: 1, shiftDate: 1, createdAt: -1 });
driverShiftSchema.index({ driverId: 1, pendingEndReport: 1 });

// Safety Net: Guarantee no raw base64 strings are saved to MongoDB
driverShiftSchema.pre("save", async function () {
  if (this.isModified("startPhotoUrl") && this.startPhotoUrl) {
    this.startPhotoUrl = (await ensureS3Image(this.startPhotoUrl, "shift-odometers", "start_odo")) || undefined;
  }
  if (this.isModified("endPhotoUrl") && this.endPhotoUrl) {
    this.endPhotoUrl = (await ensureS3Image(this.endPhotoUrl, "shift-odometers", "end_odo")) || undefined;
  }
  if (this.isModified("startPhotoUrls") && Array.isArray(this.startPhotoUrls)) {
    this.startPhotoUrls = await Promise.all(
      this.startPhotoUrls.map(async (u) => (await ensureS3Image(u, "vehicle-photos", "start_photo")) || u)
    );
  }
  if (this.isModified("endPhotoUrls") && Array.isArray(this.endPhotoUrls)) {
    this.endPhotoUrls = await Promise.all(
      this.endPhotoUrls.map(async (u) => (await ensureS3Image(u, "vehicle-photos", "end_photo")) || u)
    );
  }
});

export const DriverShift = mongoose.model<IDriverShift>("DriverShift", driverShiftSchema);
