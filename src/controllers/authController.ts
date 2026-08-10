import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { authService } from "../services/authService.js";

const loginBodySchema = z.object({
  email: z.string().email("Invalid email address format"),
  password: z.string().min(1, "Password is required"),
});

const registerBodySchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address format"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  phone: z.string().optional(),
});

export class AuthController {
  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsedBody = registerBodySchema.safeParse(req.body);

      if (!parsedBody.success) {
        res.status(422).json({
          success: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid registration payload format",
            details: parsedBody.error.flatten().fieldErrors,
          },
        });
        return;
      }

      const { name, email, password, phone } = parsedBody.data;
      const result = await authService.register(name, email, password, phone);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsedBody = loginBodySchema.safeParse(req.body);

      if (!parsedBody.success) {
        res.status(422).json({
          success: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid login credentials format",
            details: parsedBody.error.flatten().fieldErrors,
          },
        });
        return;
      }

      const { email, password } = parsedBody.data;
      const result = await authService.login(email, password);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: { code: "UNAUTHENTICATED", message: "Not authenticated" },
        });
        return;
      }

      const user = await authService.getCurrentUser(req.user.userId);

      res.status(200).json({
        success: true,
        data: {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
          role: user.role,
          phone: user.phone,
          accountStatus: user.accountStatus,
          createdAt: user.createdAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async logout(req: Request, res: Response): Promise<void> {
    res.status(200).json({
      success: true,
      data: { message: "Successfully logged out" },
    });
  }
}

export const authController = new AuthController();
