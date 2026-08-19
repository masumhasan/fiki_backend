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

  // Passenger Information
  fullName?: string;
  dateOfBirth?: string;
  confirmDob?: boolean;
  phoneNumber?: string;
  email?: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  relationship?: string;

  // Trip Information
  tripType?: string;
  schedule?: string;
  pickupDate?: string;
  pickupTime?: string;
  appointmentTime?: string;
  recurringStartDate?: string;
  recurringEndDate?: string;
  recurringDays?: string[];
  recurringPickupTime?: string;
  recurringAppointmentTime?: string;
  returnPickupAddress?: string;
  returnDestinationAddress?: string;
  returnDate?: string;
  returnPickupTime?: string;
  driverNotes?: string;

  // Mobility & Special Needs
  mobilityOptions?: string[];
  specialInstructions?: string;
  accessInformation?: string;

  // Insurance / Payment
  insuranceName?: string;
  authNumber?: string;
  privatePay?: boolean;

  // Guardian Information
  guardianName?: string;
  guardianPhone?: string;
  guardianEmail?: string;

  // Consents & Agreements
  consentPhoto?: boolean;
  consentTransport?: boolean;
  consentEsignature?: boolean;
  consentHipaa?: boolean;

  // Signature
  signature?: string;
  signatureDate?: string;
  printedName?: string;
  relationshipToPassenger?: string;
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

    // Passenger Information
    fullName: { type: String },
    dateOfBirth: { type: String },
    confirmDob: { type: Boolean },
    phoneNumber: { type: String },
    email: { type: String },
    streetAddress: { type: String },
    city: { type: String },
    state: { type: String },
    zipCode: { type: String },
    emergencyContactName: { type: String },
    emergencyContactPhone: { type: String },
    relationship: { type: String },

    // Trip Information
    tripType: { type: String },
    schedule: { type: String },
    pickupDate: { type: String },
    pickupTime: { type: String },
    appointmentTime: { type: String },
    recurringStartDate: { type: String },
    recurringEndDate: { type: String },
    recurringDays: { type: [String] },
    recurringPickupTime: { type: String },
    recurringAppointmentTime: { type: String },
    returnPickupAddress: { type: String },
    returnDestinationAddress: { type: String },
    returnDate: { type: String },
    returnPickupTime: { type: String },
    driverNotes: { type: String },

    // Mobility & Special Needs
    mobilityOptions: { type: [String] },
    specialInstructions: { type: String },
    accessInformation: { type: String },

    // Insurance / Payment
    insuranceName: { type: String },
    authNumber: { type: String },
    privatePay: { type: Boolean },

    // Guardian Information
    guardianName: { type: String },
    guardianPhone: { type: String },
    guardianEmail: { type: String },

    // Consents & Agreements
    consentPhoto: { type: Boolean },
    consentTransport: { type: Boolean },
    consentEsignature: { type: Boolean },
    consentHipaa: { type: Boolean },

    // Signature
    signature: { type: String },
    signatureDate: { type: String },
    printedName: { type: String },
    relationshipToPassenger: { type: String },
  },
  {
    timestamps: true,
  }
);

tripSchema.index({ status: 1, driverId: 1 });

export const Trip = mongoose.model<ITrip>("Trip", tripSchema);
