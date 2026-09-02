import { Router } from "express";
import { driverController } from "../controllers/driverController.js";
import { authenticate, authorize } from "../middleware/authMiddleware.js";

const router = Router();

// All driver endpoints require authentication and DRIVER role
router.use(authenticate, authorize("DRIVER"));

router.get("/me/profile", (req, res, next) => driverController.getProfile(req, res, next));
router.patch("/me/profile", (req, res, next) => driverController.updateProfile(req, res, next));
router.put("/me/profile", (req, res, next) => driverController.updateProfile(req, res, next));
router.patch("/me/availability", (req, res, next) => driverController.updateAvailability(req, res, next));
router.post("/me/location", (req, res, next) => driverController.updateLocation(req, res, next));

router.get("/me/trips", (req, res, next) => driverController.getTrips(req, res, next));
router.get("/me/trips/active", (req, res, next) => driverController.getActiveTrip(req, res, next));
router.get("/me/trips/:id", (req, res, next) => driverController.getTripById(req, res, next));
router.patch("/me/trips/:id/status", (req, res, next) => driverController.updateTripStatus(req, res, next));
router.patch("/me/trips/:id/notes", (req, res, next) => driverController.updateTripNotes(req, res, next));
router.get("/me/earnings", (req, res, next) => driverController.getEarnings(req, res, next));

router.get("/me/shifts/today", (req, res, next) => driverController.getTodayShift(req, res, next));
router.get("/me/schedule-summary", (req, res, next) => driverController.getScheduleSummary(req, res, next));
router.post("/me/shifts/start", (req, res, next) => driverController.startShift(req, res, next));
router.post("/me/shifts/end", (req, res, next) => driverController.endShift(req, res, next));

export default router;

