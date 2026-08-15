import { AppError } from "./errors.js";

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function requireConfigured(values, message) {
  if (values.some((value) => !value)) {
    throw new AppError(message, 500);
  }
}
