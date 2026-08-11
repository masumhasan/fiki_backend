import mongoose, { Document, Schema } from "mongoose";

export type TripStatus =
  | "REQUESTED"
  | "QUOTE_SENT"
  | "QUOTE_ACCEPTED"
  | "QUOTE_DENIED"
  | "QUOTE_COUNTERED"
  | "ACCEPTED"
  | "DRIVER_ARRIVING"
  | "DRIVER_ARRIVED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

export type QuoteResponseAction = "ACCEPT" | "DENY" | "COUNTER";

export interface ITrip extends Document {
  passengerId: mongoose.Types.ObjectId;
  driverId?: mongoose.Types.ObjectId;
  pickupLocation: {
    address: string;
    coordinates?: [number, number];
  };
  dropoffLocation: {
    address: string;
    coordinates?: [number, number];
  };
  status: TripStatus;
  fare?: number;
  // Quote workflow fields
  quotedFare?: number;
  quotedAt?: Date;
  quoteNote?: string;
  counterOffer?: number;
  counterOfferedAt?: Date;
  counterOfferNote?: string;
  scheduledTime?: Date;
  startedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const tripSchema = new Schema<ITrip>(
  {
    passengerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    driverId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    pickupLocation: {
      address: { type: String, required: true },
      coordinates: { type: [Number] },
    },
    dropoffLocation: {
      address: { type: String, required: true },
      coordinates: { type: [Number] },
    },
    status: {
      type: String,
      enum: [
        "REQUESTED",
        "QUOTE_SENT",
        "QUOTE_ACCEPTED",
        "QUOTE_DENIED",
        "QUOTE_COUNTERED",
        "ACCEPTED",
        "DRIVER_ARRIVING",
        "DRIVER_ARRIVED",
        "IN_PROGRESS",
        "COMPLETED",
        "CANCELLED",
      ],
      default: "REQUESTED",
      required: true,
      index: true,
    },
    fare: { type: Number },
    quotedFare: { type: Number },
    quotedAt: { type: Date },
    quoteNote: { type: String },
    counterOffer: { type: Number },
    counterOfferedAt: { type: Date },
    counterOfferNote: { type: String },
    scheduledTime: { type: Date },
    startedAt: { type: Date },
    completedAt: { type: Date },
    cancelledAt: { type: Date },
    cancellationReason: { type: String },
  },
  {
    timestamps: true,
  }
);

tripSchema.index({ status: 1, driverId: 1 });

export const Trip = mongoose.model<ITrip>("Trip", tripSchema);
