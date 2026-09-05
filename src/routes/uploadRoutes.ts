import { Router } from "express";
import multer from "multer";
import { uploadController } from "../controllers/uploadController.js";
import { authenticate } from "../middleware/authMiddleware.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
});

const handleMulterUpload = (req: any, res: any, next: any) => {
  upload.single("image")(req, res, (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({
          success: false,
          error: { code: err.code, message: `Upload error: ${err.message}` },
        });
      }
      return next(err);
    }
    next();
  });
};

const router = Router();

// Upload image route (authenticated users)
router.post("/image", authenticate, handleMulterUpload, (req, res, next) =>
  uploadController.uploadImage(req, res, next)
);

// Public upload image route (for landing page / unauthenticated forms)
router.post("/public-image", handleMulterUpload, (req, res, next) =>
  uploadController.uploadImage(req, res, next)
);

export default router;
