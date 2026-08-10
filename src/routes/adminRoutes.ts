import { Router } from "express";
import { adminController } from "../controllers/adminController.js";
import { fleetController } from "../controllers/fleetController.js";
import { authenticate, authorize } from "../middleware/authMiddleware.js";

const router = Router();

// All admin endpoints require authentication and ADMIN role
router.use(authenticate, authorize("ADMIN"));

router.get("/drivers", (req, res, next) => adminController.getDrivers(req, res, next));
router.patch("/drivers/:id/status", (req, res, next) => adminController.updateDriverStatus(req, res, next));

router.get("/trips", (req, res, next) => adminController.getTrips(req, res, next));
router.post("/trips", (req, res, next) => adminController.createTrip(req, res, next));
router.patch("/trips/:id/assign", (req, res, next) => adminController.assignDriver(req, res, next));

router.get("/analytics", (req, res, next) => adminController.getAnalytics(req, res, next));

router.get("/vehicle-reports", (req, res, next) => fleetController.getVehicleReports(req, res, next));
router.post("/vehicle-reports", (req, res, next) => fleetController.createVehicleReport(req, res, next));
router.get("/driver-applications", (req, res, next) => fleetController.getDriverApplications(req, res, next));
router.patch("/driver-applications/:id/status", (req, res, next) => fleetController.updateDriverApplicationStatus(req, res, next));

export default router;
