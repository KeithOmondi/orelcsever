// Throw this anywhere in route handlers / middleware for expected,
// "safe to show the client" errors (bad input, forbidden, not found, etc).
// Anything that isn't an AppError is treated as a bug and hidden from the client.
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly status: "fail" | "error";
  public readonly isOperational = true;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.status = statusCode >= 400 && statusCode < 500 ? "fail" : "error";

    Error.captureStackTrace(this, this.constructor);
  }
}