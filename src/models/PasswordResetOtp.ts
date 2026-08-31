import mongoose, { Document, Schema } from "mongoose";

export interface IPasswordResetOtp extends Document {
  email: string;
  otp: string;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

const passwordResetOtpSchema = new Schema<IPasswordResetOtp>(
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

passwordResetOtpSchema.index({ email: 1, otp: 1, used: 1 });

export const PasswordResetOtp = mongoose.model<IPasswordResetOtp>(
  "PasswordResetOtp",
  passwordResetOtpSchema
);
