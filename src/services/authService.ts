import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { IUser, UserRole } from "../models/User.js";
import { DriverProfile } from "../models/DriverProfile.js";
import { PasswordResetOtp } from "../models/PasswordResetOtp.js";
import { sendPasswordResetOtpEmail } from "./emailService.js";
import { userRepository } from "../repositories/userRepository.js";

export interface TokenPayload {
  userId: string;
  email: string;
  role: UserRole;
}

export interface AuthResult {
  user: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    phone?: string;
    accountStatus: string;
  };
  token: string;
}

export class AuthService {
  async login(email: string, password: string): Promise<AuthResult> {
    const user = await userRepository.findByEmail(email, true);

    if (!user) {
      throw { statusCode: 401, code: "INVALID_CREDENTIALS", message: "Invalid email or password" };
    }

    if (user.accountStatus !== "ACTIVE") {
      throw { statusCode: 403, code: "ACCOUNT_INACTIVE", message: `Account is currently ${user.accountStatus.toLowerCase()}` };
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw { statusCode: 401, code: "INVALID_CREDENTIALS", message: "Invalid email or password" };
    }

    const payload: TokenPayload = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    const token = jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    });

    return {
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        phone: user.phone,
        accountStatus: user.accountStatus,
      },
      token,
    };
  }

  async register(name: string, email: string, password: string, phone?: string, role: UserRole = "USER"): Promise<AuthResult> {
    const existing = await userRepository.findByEmail(email);
    if (existing) {
      throw { statusCode: 409, code: "EMAIL_ALREADY_EXISTS", message: "An account with this email address already exists" };
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await userRepository.create({
      name,
      email,
      passwordHash,
      role,
      phone,
      accountStatus: "ACTIVE",
    });

    if (role === "DRIVER") {
      await DriverProfile.create({
        userId: user._id,
        approvalStatus: "PENDING",
        availabilityStatus: "OFFLINE",
      });
    }

    const payload: TokenPayload = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    const token = jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    });

    return {
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        phone: user.phone,
        accountStatus: user.accountStatus,
      },
      token,
    };
  }

  async getCurrentUser(userId: string): Promise<IUser> {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw { statusCode: 404, code: "USER_NOT_FOUND", message: "User account not found" };
    }
    return user;
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    const cleanEmail = email.trim().toLowerCase();
    const user = await userRepository.findByEmail(cleanEmail);

    if (user) {
      await PasswordResetOtp.updateMany({ email: cleanEmail, used: false }, { used: true });

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await PasswordResetOtp.create({
        email: cleanEmail,
        otp,
        expiresAt,
        used: false,
      });

      await sendPasswordResetOtpEmail(cleanEmail, otp, user.name || "User");
    }

    return { message: "If an account with that email exists, a 6-digit verification code has been sent." };
  }

  async verifyOtp(email: string, otp: string): Promise<{ verified: boolean; message: string }> {
    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = otp.trim();

    const otpRecord = await PasswordResetOtp.findOne({
      email: cleanEmail,
      otp: cleanOtp,
      used: false,
      expiresAt: { $gt: new Date() },
    });

    if (!otpRecord) {
      throw { statusCode: 400, code: "INVALID_OTP", message: "Invalid or expired verification code" };
    }

    return { verified: true, message: "Verification code is valid." };
  }

  async resetPassword(email: string, otp: string, newPassword: string): Promise<{ message: string }> {
    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = otp.trim();

    const otpRecord = await PasswordResetOtp.findOne({
      email: cleanEmail,
      otp: cleanOtp,
      used: false,
      expiresAt: { $gt: new Date() },
    });

    if (!otpRecord) {
      throw { statusCode: 400, code: "INVALID_OTP", message: "Invalid or expired verification code" };
    }

    const user = await userRepository.findByEmail(cleanEmail, true);
    if (!user) {
      throw { statusCode: 404, code: "USER_NOT_FOUND", message: "User account not found" };
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    user.passwordHash = passwordHash;
    await user.save();

    otpRecord.used = true;
    await otpRecord.save();

    return { message: "Password has been reset successfully. You may now sign in." };
  }
}

export const authService = new AuthService();
