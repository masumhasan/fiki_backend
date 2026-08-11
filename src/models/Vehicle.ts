import { Document, Schema, model } from "mongoose";

export interface IVehicle extends Document {
  modelName: string;
  licensePlate: string;
  vin: string;
  year: number;
  fleetId: string;
  status: "Active" | "Inactive" | "Maintenance";
  assignedDriverId?: Schema.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const vehicleSchema = new Schema<IVehicle>(
  {
    modelName: { type: String, required: true },
    licensePlate: { type: String, required: true },
    vin: { type: String, required: true, unique: true },
    year: { type: Number, required: true },
    fleetId: { type: String, required: true },
    status: {
      type: String,
      enum: ["Active", "Inactive", "Maintenance"],
      default: "Active",
    },
    assignedDriverId: { type: Schema.Types.ObjectId, ref: "Driver" },
  },
  { timestamps: true }
);

export const Vehicle = model<IVehicle>("Vehicle", vehicleSchema);
