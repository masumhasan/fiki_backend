import { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { User } from "../../models/User.js";
import { DriverProfile } from "../../models/DriverProfile.js";

export class AdminUserController {
  async getUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const search = (req.query.search as string)?.trim() || "";
      const role = (req.query.role as string)?.trim();
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit as string, 10) || 50));

      const filter: any = {};
      if (role && role !== "ALL") {
        if (role === "PASSENGER") {
          filter.role = "USER";
        } else {
          filter.role = role.toUpperCase();
        }
      }

      if (search) {
        const regex = new RegExp(search, "i");
        filter.$or = [
          { name: regex },
          { email: regex },
          { phone: regex },
        ];
      }

      const [total, users, passengerCount, driverCount, adminCount, allTotal] = await Promise.all([
        User.countDocuments(filter),
        User.find(filter)
          .select("-passwordHash")
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        User.countDocuments({ role: "USER" }),
        User.countDocuments({ role: "DRIVER" }),
        User.countDocuments({ role: "ADMIN" }),
        User.countDocuments({}),
      ]);

      res.status(200).json({
        success: true,
        data: {
          users,
          total,
          page,
          totalPages: Math.ceil(total / limit) || 1,
          counts: {
            total: allTotal,
            passengers: passengerCount,
            drivers: driverCount,
            admins: adminCount,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, error: { code: "INVALID_ID", message: "Invalid user ID format" } });
        return;
      }

      const { name, email, phone, role, accountStatus } = req.body;

      const user = await User.findById(id);
      if (!user) {
        res.status(404).json({ success: false, error: { code: "USER_NOT_FOUND", message: "User not found" } });
        return;
      }

      if (email && email.toLowerCase() !== user.email.toLowerCase()) {
        const existingEmail = await User.findOne({
          email: email.toLowerCase().trim(),
          _id: { $ne: id },
        });
        if (existingEmail) {
          res.status(409).json({ success: false, error: { code: "EMAIL_EXISTS", message: "Email is already in use by another user" } });
          return;
        }
        user.email = email.toLowerCase().trim();
      }

      if (name !== undefined) user.name = name.trim();
      if (phone !== undefined) user.phone = phone.trim();
      if (accountStatus !== undefined) user.accountStatus = accountStatus;

      const oldRole = user.role;
      if (role && ["ADMIN", "DRIVER", "USER"].includes(role)) {
        user.role = role;
      }

      await user.save();

      // If role became DRIVER, ensure DriverProfile exists
      if (user.role === "DRIVER" && oldRole !== "DRIVER") {
        const existingProfile = await DriverProfile.findOne({ userId: user._id });
        if (!existingProfile) {
          await DriverProfile.create({
            userId: user._id,
            approvalStatus: "APPROVED",
            availabilityStatus: "OFFLINE",
            completedTripsCount: 0,
            hourlyRate: 20,
            approvedHours: 0,
            tripBonusRate: 5,
            payrollStatus: "PENDING",
            weeklySchedule: [
              { day: "Mon", working: false },
              { day: "Tue", working: false },
              { day: "Wed", working: false },
              { day: "Thu", working: false },
              { day: "Fri", working: false },
              { day: "Sat", working: false },
              { day: "Sun", working: false },
            ],
            oneTimeChanges: [],
          });
        }
      }

      const updatedUser = await User.findById(id).select("-passwordHash");
      res.status(200).json({
        success: true,
        data: updatedUser,
        message: "User updated successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, error: { code: "INVALID_ID", message: "Invalid user ID format" } });
        return;
      }

      const authUser = (req as any).user;
      if (authUser && (authUser._id?.toString() === id || authUser.id === id)) {
        res.status(400).json({
          success: false,
          error: { code: "CANNOT_DELETE_SELF", message: "You cannot delete your own admin account while logged in." },
        });
        return;
      }

      const user = await User.findById(id);
      if (!user) {
        res.status(404).json({ success: false, error: { code: "USER_NOT_FOUND", message: "User not found" } });
        return;
      }

      await User.findByIdAndDelete(id);
      await DriverProfile.deleteMany({ userId: id });

      res.status(200).json({
        success: true,
        message: "User permanently deleted",
      });
    } catch (error) {
      next(error);
    }
  }
}

export const adminUserController = new AdminUserController();
