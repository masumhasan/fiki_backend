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
          privacyPolicy: { passengers: "", drivers: "", general: "" },
          termsOfService: { passengers: "", drivers: "", general: "" },
          helpCenter: { passengers: "", drivers: "", general: "" },
        };
        res.status(200).json({ success: true, data: defaultContent });
        return;
      }
      res.status(200).json({ success: true, data: JSON.parse(setting.value) });
    } catch (error) {
      next(error);
    }
  },
};
