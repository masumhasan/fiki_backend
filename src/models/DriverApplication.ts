import { Document, Schema, model } from "mongoose";

export interface IDriverApplication extends Document {
  applicationId: string;
  fullName: string;
  email: string;
  phone: string;
  licenseNumber: string;
  positionType: "AMBULATORY" | "WHEELCHAIR" | "STRETCHER";
  backgroundStatus: "CLEARED" | "PENDING" | "FAILED";
  status: "PENDING_REVIEW" | "INTERVIEW_SCHEDULED" | "APPROVED" | "REJECTED";
  submittedDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

const driverApplicationSchema = new Schema<IDriverApplication>(
  {
    applicationId: { type: String, required: true, unique: true },
    fullName: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    licenseNumber: { type: String, required: true },
    positionType: {
      type: String,
      enum: ["AMBULATORY", "WHEELCHAIR", "STRETCHER"],
      default: "AMBULATORY",
    },
    backgroundStatus: {
      type: String,
      enum: ["CLEARED", "PENDING", "FAILED"],
      default: "PENDING",
    },
    status: {
      type: String,
      enum: ["PENDING_REVIEW", "INTERVIEW_SCHEDULED", "APPROVED", "REJECTED"],
      default: "PENDING_REVIEW",
    },
    submittedDate: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const DriverApplication = model<IDriverApplication>("DriverApplication", driverApplicationSchema);
