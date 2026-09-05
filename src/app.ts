import cors from "cors";
import express, { Express } from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import adminRoutes from "./routes/adminRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import driverRoutes from "./routes/driverRoutes.js";
import healthRoutes from "./routes/healthRoutes.js";
import landingRoutes from "./routes/landingRoutes.js";
import tripRoutes from "./routes/tripRoutes.js";
import settingsRoutes from "./routes/settingsRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";

import path from "path";

const app: Express = express();

// Trust proxy for correct protocol and host resolution behind reverse proxy
app.set("trust proxy", 1);

// Security Headers
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// Serve static uploaded files
app.use(
  "/uploads",
  express.static(path.join(process.cwd(), "uploads"), {
    setHeaders: (res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
  })
);

// Request ID Tracing
app.use(requestIdMiddleware);

// CORS Policy
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, postman) or matching frontend origins
      if (
        !origin ||
        env.CORS_ORIGIN === "*" ||
        origin.includes("localhost") ||
        origin.includes("127.0.0.1") ||
        origin.includes("184.73.163.84") ||
        origin.includes("fikitransit.com") ||
        (env.CORS_ORIGIN && origin.includes(env.CORS_ORIGIN))
      ) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

// Body Parser
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ limit: "500mb", extended: true }));

// Health Check Routes
app.use("/", healthRoutes);

// API Routes (versioned)
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/drivers", driverRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/trips", tripRoutes);
app.use("/api/v1/landing", landingRoutes);
app.use("/api/v1/settings", settingsRoutes);
app.use("/api/v1/upload", uploadRoutes);

// 404 Handler for unmatched routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: "ROUTE_NOT_FOUND",
      message: `Cannot ${req.method} ${req.path}`,
    },
  });
});

// Centralized Error Handling Middleware
app.use(errorHandler);

export default app;
