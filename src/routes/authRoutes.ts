import { Router } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";
import { authController } from "../controllers/authController.js";
import { authenticate } from "../middleware/authMiddleware.js";

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.NODE_ENV === "development" ? 500 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: "RATE_LIMIT_EXCEEDED",
      message: "Too many authentication requests, please try again later",
    },
  },
});

const router = Router();

router.post("/register", authLimiter, (req, res, next) => authController.register(req, res, next));
router.post("/login", authLimiter, (req, res, next) => authController.login(req, res, next));
router.post("/forgot-password", authLimiter, (req, res, next) => authController.forgotPassword(req, res, next));
router.post("/verify-otp", authLimiter, (req, res, next) => authController.verifyOtp(req, res, next));
router.post("/reset-password", authLimiter, (req, res, next) => authController.resetPassword(req, res, next));
router.get("/me", authenticate, (req, res, next) => authController.me(req, res, next));
router.post("/logout", authenticate, (req, res, next) => authController.logout(req, res));

export default router;
