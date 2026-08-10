import { NextFunction, Request, Response } from "express";

export interface CustomError extends Error {
  statusCode?: number;
  code?: string;
  details?: unknown;
}

export function errorHandler(
  err: CustomError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  const statusCode = err.statusCode || 500;
  const code = err.code || "INTERNAL_SERVER_ERROR";
  const message = err.message || "An unexpected error occurred on the server";

  console.error(`[ERROR] [${req.requestId || "NO-REQ-ID"}] ${req.method} ${req.path} - ${statusCode} ${code}:`, err);

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message: statusCode === 500 && process.env.NODE_ENV === "production"
        ? "An internal server error occurred"
        : message,
      ...(err.details ? { details: err.details } : {}),
    },
  });
}
