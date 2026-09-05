import { Router } from "express";
import { settingsController } from "../controllers/settingsController.js";
import { authenticate } from "../middleware/authMiddleware.js";

const router = Router();

// Public routes
router.get("/dispatch-number", (req, res, next) => settingsController.getDispatchNumber(req, res, next));
router.get("/crm-content", (req, res, next) => settingsController.getCrmContent(req, res, next));

// Authenticated routes (if any in future)
// router.use(authenticate);

export default router;
