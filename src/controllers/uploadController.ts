import { Request, Response, NextFunction } from "express";
import { uploadImageToS3 } from "../services/s3Service.js";

export class UploadController {
  async uploadImage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const category = (req.body.category || req.query.category || "shift-odometers") as string;

      const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
      const host = req.get("host");
      const customBaseUrl = host ? `${proto}://${host}` : undefined;

      // 1. Check if multipart file uploaded via multer
      if (req.file) {
        const url = await uploadImageToS3(
          req.file.buffer,
          req.file.originalname || "photo.jpg",
          req.file.mimetype || "image/jpeg",
          category,
          customBaseUrl
        );
        res.status(200).json({
          success: true,
          data: { url },
        });
        return;
      }

      // 2. Check if base64 payload uploaded
      const { imageBase64, fileName = "photo.jpg", mimeType = "image/jpeg" } = req.body;
      if (imageBase64) {
        const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(cleanBase64, "base64");
        const url = await uploadImageToS3(buffer, fileName, mimeType, category, customBaseUrl);
        res.status(200).json({
          success: true,
          data: { url },
        });
        return;
      }

      res.status(400).json({
        success: false,
        error: { code: "NO_FILE_PROVIDED", message: "No image file or base64 data provided" },
      });
    } catch (error) {
      next(error);
    }
  }
}

export const uploadController = new UploadController();
