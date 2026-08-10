import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { IUser, UserRole } from "../models/User.js";
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

  async register(name: string, email: string, password: string, phone?: string): Promise<AuthResult> {
    const existing = await userRepository.findByEmail(email);
    if (existing) {
      throw { statusCode: 409, code: "EMAIL_ALREADY_EXISTS", message: "An account with this email address already exists" };
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await userRepository.create({
      name,
      email,
      passwordHash,
      role: "USER",
      phone,
      accountStatus: "ACTIVE",
    });

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
}

export const authService = new AuthService();
