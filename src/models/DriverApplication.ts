import { Document, Schema, model } from "mongoose";

export interface IDriverApplication extends Document {
  applicationId: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  email: string;
  phone: string;
  licenseNumber: string;
  positionType: "AMBULATORY" | "WHEELCHAIR" | "STRETCHER";
  backgroundStatus: "CLEARED" | "PENDING" | "FAILED";
  status: "PENDING_REVIEW" | "INTERVIEW_SCHEDULED" | "APPROVED" | "REJECTED";
  assignedVehicleId?: Schema.Types.ObjectId;
  submittedDate: Date;

  // Personal Address
  streetAddress?: string;
  streetAddress2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;

  // Job Details
  position?: string;
  availableStartDate?: string;
  employmentStatus?: string;
  desiredSalary?: string;
  howDidYouHear?: string;

  // Eligibility
  authorizedInUS?: string;
  felonyConviction?: string;
  felonyExplanation?: string;

  // Education
  highSchool?: string;
  highSchoolGraduated?: string;
  college?: string;
  collegeGraduated?: string;
  degree?: string;

  // Previous Employment
  previousEmployer?: string;
  jobTitle?: string;
  startingSalary?: string;
  endingSalary?: string;
  responsibilities?: string;
  employmentFromDate?: string;
  employmentToDate?: string;
  reasonForLeaving?: string;

  // Reference
  referenceName?: string;
  referenceRelationship?: string;
  referencePhone?: string;

  // Identification & Legal
  driverCategory?: string;
  licenseExpirationDate?: string;
  socialSecurityNumber?: string;
  dateOfBirth?: string;
  signature?: string;
  bidForm?: string;
  authorizeBackgroundCheck?: boolean;

  createdAt: Date;
  updatedAt: Date;
}

const driverApplicationSchema = new Schema<IDriverApplication>(
  {
    applicationId: { type: String, required: true, unique: true },
    fullName: { type: String, required: true },
    firstName: { type: String },
    lastName: { type: String },
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
      default: "CLEARED",
    },
    status: {
      type: String,
      enum: ["PENDING_REVIEW", "INTERVIEW_SCHEDULED", "APPROVED", "REJECTED"],
      default: "PENDING_REVIEW",
    },
    assignedVehicleId: { type: Schema.Types.ObjectId, ref: "Vehicle" },
    submittedDate: { type: Date, default: Date.now },

    streetAddress: { type: String },
    streetAddress2: { type: String },
    city: { type: String },
    state: { type: String },
    zipCode: { type: String },
    country: { type: String },

    position: { type: String },
    availableStartDate: { type: String },
    employmentStatus: { type: String },
    desiredSalary: { type: String },
    howDidYouHear: { type: String },

    authorizedInUS: { type: String },
    felonyConviction: { type: String },
    felonyExplanation: { type: String },

    highSchool: { type: String },
    highSchoolGraduated: { type: String },
    college: { type: String },
    collegeGraduated: { type: String },
    degree: { type: String },

    previousEmployer: { type: String },
    jobTitle: { type: String },
    startingSalary: { type: String },
    endingSalary: { type: String },
    responsibilities: { type: String },
    employmentFromDate: { type: String },
    employmentToDate: { type: String },
    reasonForLeaving: { type: String },

    referenceName: { type: String },
    referenceRelationship: { type: String },
    referencePhone: { type: String },

    driverCategory: { type: String },
    licenseExpirationDate: { type: String },
    socialSecurityNumber: { type: String },
    dateOfBirth: { type: String },
    signature: { type: String },
    bidForm: { type: String },
    authorizeBackgroundCheck: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const DriverApplication = model<IDriverApplication>("DriverApplication", driverApplicationSchema);
