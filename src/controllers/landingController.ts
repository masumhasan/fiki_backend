import { NextFunction, Request, Response } from "express";
import { z } from "zod";

const estimateBodySchema = z.object({
  pickupAddress: z.string().min(1, "Pickup address is required"),
  dropoffAddress: z.string().min(1, "Dropoff address is required"),
  mobilityType: z.enum(["STANDARD", "WHEELCHAIR", "STRETCHER"]).default("STANDARD"),
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
}

export const landingController = new LandingController();
