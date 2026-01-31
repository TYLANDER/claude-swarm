import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";

/**
 * Format Zod errors into a user-friendly structure
 */
function formatZodErrors(error: ZodError): { field: string; message: string }[] {
  return error.errors.map((err) => ({
    field: err.path.join(".") || "root",
    message: err.message,
  }));
}

/**
 * Validation middleware factory for request body
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({
        error: "Validation failed",
        details: formatZodErrors(result.error),
      });
      return;
    }

    // Replace body with validated/transformed data
    req.body = result.data;
    next();
  };
}

/**
 * Validation middleware factory for URL parameters
 */
export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      res.status(400).json({
        error: "Invalid URL parameters",
        details: formatZodErrors(result.error),
      });
      return;
    }

    req.params = result.data as typeof req.params;
    next();
  };
}

/**
 * Validation middleware factory for query parameters
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      res.status(400).json({
        error: "Invalid query parameters",
        details: formatZodErrors(result.error),
      });
      return;
    }

    req.query = result.data as typeof req.query;
    next();
  };
}

/**
 * Combined validation for body, params, and query
 */
export function validate<B, P, Q>(options: {
  body?: ZodSchema<B>;
  params?: ZodSchema<P>;
  query?: ZodSchema<Q>;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: { location: string; details: { field: string; message: string }[] }[] = [];

    if (options.body) {
      const result = options.body.safeParse(req.body);
      if (!result.success) {
        errors.push({ location: "body", details: formatZodErrors(result.error) });
      } else {
        req.body = result.data;
      }
    }

    if (options.params) {
      const result = options.params.safeParse(req.params);
      if (!result.success) {
        errors.push({ location: "params", details: formatZodErrors(result.error) });
      } else {
        req.params = result.data as typeof req.params;
      }
    }

    if (options.query) {
      const result = options.query.safeParse(req.query);
      if (!result.success) {
        errors.push({ location: "query", details: formatZodErrors(result.error) });
      } else {
        req.query = result.data as typeof req.query;
      }
    }

    if (errors.length > 0) {
      res.status(400).json({
        error: "Validation failed",
        errors,
      });
      return;
    }

    next();
  };
}
