import { Router } from "express";
import { settingsController } from "../controllers/settingsController.js";
import { authenticate } from "../middleware/authMiddleware.js";

const router = Router();

router.use(authenticate);

router.get("/dispatch-number", (req, res, next) => settingsController.getDispatchNumber(req, res, next));

export default router;
