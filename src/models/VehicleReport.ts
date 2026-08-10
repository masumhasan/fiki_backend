import { Document, Schema, model } from "mongoose";

export interface IVehicleReport extends Document {
  vehicleId: string;
  make: string;
  vehicleModel: string;
  licensePlate: string;
  inspectionStatus: "PASS" | "FAIL" | "MAINTENANCE_REQUIRED";
  fuelLevelPercentage: number;
  wheelchairLiftOperational: boolean;
  notes?: string;
  inspectorName: string;
  createdAt: Date;
  updatedAt: Date;
}

const vehicleReportSchema = new Schema<IVehicleReport>(
  {
    vehicleId: { type: String, required: true, index: true },
    make: { type: String, required: true },
    vehicleModel: { type: String, required: true },
    licensePlate: { type: String, required: true },
    inspectionStatus: {
      type: String,
      enum: ["PASS", "FAIL", "MAINTENANCE_REQUIRED"],
      default: "PASS",
    },
    fuelLevelPercentage: { type: Number, required: true, min: 0, max: 100 },
    wheelchairLiftOperational: { type: Boolean, default: true },
    notes: { type: String },
    inspectorName: { type: String, required: true },
  },
  { timestamps: true }
);

export const VehicleReport = model<IVehicleReport>("VehicleReport", vehicleReportSchema);
