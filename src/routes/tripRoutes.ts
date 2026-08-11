import { Router } from "express";
import { tripController } from "../controllers/tripController.js";
import { authenticate } from "../middleware/authMiddleware.js";

const router = Router();

// All trip endpoints require authentication
router.use(authenticate);

router.post("/", (req, res, next) => tripController.requestTrip(req, res, next));
router.get("/me", (req, res, next) => tripController.getMyTrips(req, res, next));
router.patch("/:id/cancel", (req, res, next) => tripController.cancelTrip(req, res, next));
router.patch("/:id/quote/respond", (req, res, next) => tripController.respondToQuote(req, res, next));

export default router;
