import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { DriverApplication } from "../models/DriverApplication.js";

const estimateBodySchema = z.object({
  pickupAddress: z.string().min(1, "Pickup address is required"),
  dropoffAddress: z.string().min(1, "Dropoff address is required"),
  mobilityType: z.enum(["STANDARD", "WHEELCHAIR", "STRETCHER"]).default("STANDARD"),
});

const jobApplicationSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email("Valid email address is required"),
  phone: z.string().min(1, "Phone number is required"),
  licenseNumber: z.string().min(1, "Driver license number is required"),
  positionType: z.enum(["AMBULATORY", "WHEELCHAIR", "STRETCHER"]).default("AMBULATORY"),

  streetAddress: z.string().optional(),
  streetAddress2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  country: z.string().optional(),

  position: z.string().optional(),
  availableStartDate: z.string().optional(),
  employmentStatus: z.string().optional(),
  desiredSalary: z.string().optional(),
  howDidYouHear: z.string().optional(),

  authorizedInUS: z.string().optional(),
  felonyConviction: z.string().optional(),
  felonyExplanation: z.string().optional(),

  highSchool: z.string().optional(),
  highSchoolGraduated: z.string().optional(),
  college: z.string().optional(),
  collegeGraduated: z.string().optional(),
  degree: z.string().optional(),

  previousEmployer: z.string().optional(),
  jobTitle: z.string().optional(),
  startingSalary: z.string().optional(),
  endingSalary: z.string().optional(),
  responsibilities: z.string().optional(),
  employmentFromDate: z.string().optional(),
  employmentToDate: z.string().optional(),
  reasonForLeaving: z.string().optional(),

  referenceName: z.string().optional(),
  referenceRelationship: z.string().optional(),
  referencePhone: z.string().optional(),

  driverCategory: z.string().optional(),
  licenseExpirationDate: z.string().optional(),
  socialSecurityNumber: z.string().optional(),
  dateOfBirth: z.string().optional(),
  signature: z.string().optional(),
});

export class LandingController {
  async estimateFare(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsedBody = estimateBodySchema.safeParse(req.body);

      if (!parsedBody.success) {
        res.status(422).json({
          success: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid fare estimate request payload",
            details: parsedBody.error.flatten().fieldErrors,
          },
        });
        return;
      }

      const { mobilityType } = parsedBody.data;

      // Base fare calculation engine
      let baseFare = 25.00;
      let perMileRate = 2.50;

      if (mobilityType === "WHEELCHAIR") {
        baseFare = 45.00;
        perMileRate = 3.50;
      } else if (mobilityType === "STRETCHER") {
        baseFare = 85.00;
        perMileRate = 5.00;
      }

      // Simulated estimated distance (12.5 miles)
      const estimatedDistanceMiles = 12.5;
      const calculatedFare = Math.round((baseFare + estimatedDistanceMiles * perMileRate) * 100) / 100;

      res.status(200).json({
        success: true,
        data: {
          pickupAddress: parsedBody.data.pickupAddress,
          dropoffAddress: parsedBody.data.dropoffAddress,
          mobilityType: parsedBody.data.mobilityType,
          estimatedDistanceMiles,
          estimatedFare: calculatedFare,
          currency: "USD",
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async submitJobApplication(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsedBody = jobApplicationSchema.safeParse(req.body);

      if (!parsedBody.success) {
        res.status(422).json({
          success: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid job application payload format",
            details: parsedBody.error.flatten().fieldErrors,
          },
        });
        return;
      }

      const payload = parsedBody.data;
      const applicationId = `APP-2026-${Math.floor(100 + Math.random() * 900)}`;

      const application = await DriverApplication.create({
        ...payload,
        applicationId,
        email: payload.email.toLowerCase(),
        backgroundStatus: "CLEARED",
        status: "PENDING_REVIEW",
        submittedDate: new Date(),
      });

      res.status(201).json({
        success: true,
        data: application,
      });
    } catch (error) {
      next(error);
    }
  }

  async getMyApplication(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user || !req.user.email) {
        res.status(401).json({
          success: false,
          error: { code: "UNAUTHENTICATED", message: "User not authenticated" },
        });
        return;
      }

      const application = await DriverApplication.findOne({
        email: req.user.email.toLowerCase(),
      }).populate("assignedVehicleId");

      res.status(200).json({
        success: true,
        data: application || null,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const landingController = new LandingController();
