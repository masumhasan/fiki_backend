import { Router } from "express";
import multer from "multer";
import { uploadController } from "../controllers/uploadController.js";
import { authenticate } from "../middleware/authMiddleware.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

const router = Router();

// Upload image route (authenticated users)
router.post("/image", authenticate, upload.single("image"), (req, res, next) =>
  uploadController.uploadImage(req, res, next)
);

export default router;
