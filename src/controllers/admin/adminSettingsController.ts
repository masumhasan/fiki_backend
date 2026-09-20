import { NextFunction, Request, Response } from "express";
import { Setting } from "../../models/Setting.js";

export class AdminSettingsController {
  async updateDispatchNumber(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { dispatchNumber } = req.body;
      if (!dispatchNumber) {
        res.status(422).json({ success: false, error: { code: "VALIDATION_FAILED", message: "dispatchNumber is required" } });
        return;
      }

      const setting = await Setting.findOneAndUpdate(
        { key: "dispatchNumber" },
        { value: dispatchNumber },
        { new: true, upsert: true }
      );

      res.status(200).json({
        success: true,
        data: { dispatchNumber: setting.value },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateCrmContent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { crmContent } = req.body;
      if (!crmContent) {
        res.status(422).json({ success: false, error: { code: "VALIDATION_FAILED", message: "crmContent is required" } });
        return;
      }

      const cleanHtml = (raw: any): any => {
        if (typeof raw === "string") {
          return raw.replace(/&nbsp;/g, " ").replace(/\u00A0/g, " ");
        }
        if (typeof raw === "object" && raw !== null) {
          const resObj: any = {};
          for (const k of Object.keys(raw)) {
            resObj[k] = cleanHtml(raw[k]);
          }
          return resObj;
        }
        return raw;
      };

      const cleanedContent = cleanHtml(crmContent);

      for (const key of ["privacyPolicy", "termsOfService", "helpCenter"]) {
        if (cleanedContent[key] !== undefined) {
          await Setting.findOneAndUpdate(
            { key },
            { value: cleanedContent[key] }, // Save as a flat string
            { new: true, upsert: true }
          );
        }
      }

      res.status(200).json({
        success: true,
        data: cleanedContent,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const adminSettingsController = new AdminSettingsController();
