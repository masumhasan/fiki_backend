import { Request, Response, NextFunction } from "express";
import { Setting } from "../models/Setting.js";

export const settingsController = {
  async getDispatchNumber(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      let setting = await Setting.findOne({ key: "dispatchNumber" });
      if (!setting) {
        // Return a default if not set
        res.status(200).json({ success: true, data: { dispatchNumber: "18003454825" } });
        return;
      }
      res.status(200).json({ success: true, data: { dispatchNumber: setting.value } });
    } catch (error) {
      next(error);
    }
  },

  async getCrmContent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const keys = ["privacyPolicy", "termsOfService", "helpCenter"];
      const settings = await Setting.find({ key: { $in: keys } });
      const data: any = {
        privacyPolicy: "",
        termsOfService: "",
        helpCenter: "",
      };

      settings.forEach((s) => {
        data[s.key] = s.value;
      });

      const cleanHtml = (raw: string): string => {
        if (!raw) return "";
        return raw.replace(/&nbsp;/g, " ").replace(/\u00A0/g, " ");
      };

      const normalize = (val: any): string => {
        if (!val) return "";
        if (typeof val === "string") return cleanHtml(val);
        if (typeof val === "object") {
          const parts = [val.general, val.passengers, val.drivers].filter(
            (p) => p && typeof p === "string" && p.trim() !== ""
          );
          if (parts.length === 0) return "";
          return cleanHtml(Array.from(new Set(parts)).join("<br/><br/>"));
        }
        return "";
      };

      // Fallback to migrate old structured data
      const oldSetting = await Setting.findOne({ key: "crmContent" });
      if (oldSetting) {
        try {
          const parsed = JSON.parse(oldSetting.value);
          if (!data.privacyPolicy && parsed.privacyPolicy) data.privacyPolicy = normalize(parsed.privacyPolicy);
          if (!data.termsOfService && parsed.termsOfService) data.termsOfService = normalize(parsed.termsOfService);
          if (!data.helpCenter && parsed.helpCenter) data.helpCenter = normalize(parsed.helpCenter);
        } catch (e) {
          console.error("Error parsing old crmContent", e);
        }
      }

      // Ensure data is cleaned/normalized even if from new keys
      res.status(200).json({
        success: true,
        data: {
          privacyPolicy: normalize(data.privacyPolicy),
          termsOfService: normalize(data.termsOfService),
          helpCenter: normalize(data.helpCenter),
        },
      });
    } catch (error) {
      next(error);
    }
  },
};
