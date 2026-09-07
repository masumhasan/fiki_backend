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
      let setting = await Setting.findOne({ key: "crmContent" });
      if (!setting) {
        // Return a default if not set
        const defaultContent = {
          privacyPolicy: "",
          termsOfService: "",
          helpCenter: "",
        };
        res.status(200).json({ success: true, data: defaultContent });
        return;
      }

      const parsed = JSON.parse(setting.value);
      const normalize = (val: any): string => {
        if (!val) return "";
        if (typeof val === "string") return val;
        if (typeof val === "object") {
          const parts = [val.general, val.passengers, val.drivers].filter(
            (p) => p && typeof p === "string" && p.trim() !== ""
          );
          if (parts.length === 0) return "";
          return Array.from(new Set(parts)).join("<br/><br/>");
        }
        return "";
      };

      const normalized = {
        privacyPolicy: normalize(parsed.privacyPolicy),
        termsOfService: normalize(parsed.termsOfService),
        helpCenter: normalize(parsed.helpCenter),
      };

      res.status(200).json({ success: true, data: normalized });
    } catch (error) {
      next(error);
    }
  },
};
