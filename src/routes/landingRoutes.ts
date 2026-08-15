import { Router } from "express";
import { landingController } from "../controllers/landingController.js";

const router = Router();

router.post("/estimate", (req, res, next) => landingController.estimateFare(req, res, next));
router.post("/job-application", (req, res, next) => landingController.submitJobApplication(req, res, next));

export default router;
