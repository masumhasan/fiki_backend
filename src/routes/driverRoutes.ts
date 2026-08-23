import { Router } from "express";
import { driverController } from "../controllers/driverController.js";
import { authenticate, authorize } from "../middleware/authMiddleware.js";

const router = Router();

// All driver endpoints require authentication and DRIVER role
router.use(authenticate, authorize("DRIVER"));

router.get("/me/profile", (req, res, next) => driverController.getProfile(req, res, next));
router.patch("/me/availability", (req, res, next) => driverController.updateAvailability(req, res, next));
router.post("/me/location", (req, res, next) => driverController.updateLocation(req, res, next));

router.get("/me/trips", (req, res, next) => driverController.getTrips(req, res, next));
router.get("/me/trips/:id", (req, res, next) => driverController.getTripById(req, res, next));
router.patch("/me/trips/:id/status", (req, res, next) => driverController.updateTripStatus(req, res, next));
router.patch("/me/trips/:id/notes", (req, res, next) => driverController.updateTripNotes(req, res, next));
router.get("/me/earnings", (req, res, next) => driverController.getEarnings(req, res, next));

export default router;
