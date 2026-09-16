import mongoose, { Document, Schema } from "mongoose";

export interface IRegistrationOtp extends Document {
  email: string;
  otp: string;
  role?: string;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

const registrationOtpSchema = new Schema<IRegistrationOtp>(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    otp: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ["USER", "DRIVER", "ADMIN"],
      default: "USER",
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: "15m" }, // TTL index automatically cleans up expired records
    },
    used: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

registrationOtpSchema.index({ email: 1, otp: 1, used: 1 });

export const RegistrationOtp = mongoose.model<IRegistrationOtp>(
  "RegistrationOtp",
  registrationOtpSchema
);
