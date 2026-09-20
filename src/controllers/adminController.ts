import { NextFunction, Request, Response } from "express";
import { adminDriverController, AdminDriverController } from "./admin/adminDriverController.js";
import { adminTripController, AdminTripController } from "./admin/adminTripController.js";
import { adminAnalyticsController, AdminAnalyticsController } from "./admin/adminAnalyticsController.js";
import { adminEarningsController, AdminEarningsController } from "./admin/adminEarningsController.js";
import { adminSettingsController, AdminSettingsController } from "./admin/adminSettingsController.js";
import { adminUserController, AdminUserController } from "./admin/adminUserController.js";

// Re-export utility functions and domain controllers for full backwards compatibility
export * from "./admin/adminDriverUtils.js";
export * from "./admin/adminDriverController.js";
export * from "./admin/adminTripController.js";
export * from "./admin/adminAnalyticsController.js";
export * from "./admin/adminEarningsController.js";
export * from "./admin/adminSettingsController.js";
export * from "./admin/adminUserController.js";

/**
 * AdminController Facade
 * Unifies specialized domain controllers into a single backwards-compatible interface.
 */
export class AdminController {
  // --- Driver Domain ---
  getDriverById = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminDriverController.getDriverById(req, res, next);

  getDrivers = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminDriverController.getDrivers(req, res, next);

  updateDriverStatus = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminDriverController.updateDriverStatus(req, res, next);

  deleteDriver = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminDriverController.deleteDriver(req, res, next);

  updateDriverProfile = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminDriverController.updateDriverProfile(req, res, next);

  updateDriverSchedule = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminDriverController.updateDriverSchedule(req, res, next);

  addOneTimeChange = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminDriverController.addOneTimeChange(req, res, next);

  getOneTimeChanges = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminDriverController.getOneTimeChanges(req, res, next);

  updateOneTimeChange = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminDriverController.updateOneTimeChange(req, res, next);

  deleteOneTimeChange = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminDriverController.deleteOneTimeChange(req, res, next);

  getScheduleOverview = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminDriverController.getScheduleOverview(req, res, next);

  // --- Trip Domain ---
  createTrip = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminTripController.createTrip(req, res, next);

  getTrips = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminTripController.getTrips(req, res, next);

  assignDriver = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminTripController.assignDriver(req, res, next);

  approveRideRequest = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminTripController.approveRideRequest(req, res, next);

  rejectRideRequest = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminTripController.rejectRideRequest(req, res, next);

  updateTrip = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminTripController.updateTrip(req, res, next);

  deleteTrip = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminTripController.deleteTrip(req, res, next);

  regenerateTrips = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminTripController.regenerateTrips(req, res, next);

  getTripById = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminTripController.getTripById(req, res, next);

  cancelTripAdmin = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminTripController.cancelTripAdmin(req, res, next);

  sendQuote = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminTripController.sendQuote(req, res, next);

  respondToCounterOffer = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminTripController.respondToCounterOffer(req, res, next);

  // --- Analytics Domain ---
  getAnalytics = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminAnalyticsController.getAnalytics(req, res, next);

  // --- Earnings Domain ---
  getDriverEarningsList = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminEarningsController.getDriverEarningsList(req, res, next);

  updateDriverEarnings = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminEarningsController.updateDriverEarnings(req, res, next);

  // --- Settings Domain ---
  updateDispatchNumber = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminSettingsController.updateDispatchNumber(req, res, next);

  updateCrmContent = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminSettingsController.updateCrmContent(req, res, next);

  // --- User Domain ---
  getUsers = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminUserController.getUsers(req, res, next);

  updateUser = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminUserController.updateUser(req, res, next);

  deleteUser = (req: Request, res: Response, next: NextFunction): Promise<void> =>
    adminUserController.deleteUser(req, res, next);
}

export const adminController = new AdminController();
