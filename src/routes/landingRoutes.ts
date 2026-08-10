import { Router } from "express";
import { landingController } from "../controllers/landingController.js";

const router = Router();

router.post("/estimate", (req, res, next) => landingController.estimateFare(req, res, next));

export default router;
