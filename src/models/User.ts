import mongoose, { Document, Schema } from "mongoose";

export type UserRole = "ADMIN" | "DRIVER" | "USER";
export type AccountStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "INACTIVE";

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  role: UserRole;
  name: string;
  phone?: string;
  accountStatus: AccountStatus;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: ["ADMIN", "DRIVER", "USER"],
      default: "USER",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    accountStatus: {
      type: String,
      enum: ["PENDING", "ACTIVE", "SUSPENDED", "INACTIVE"],
      default: "ACTIVE",
      required: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.index({ email: 1, role: 1 });

export const User = mongoose.model<IUser>("User", userSchema);
