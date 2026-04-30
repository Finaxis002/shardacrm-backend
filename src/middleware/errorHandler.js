import ApiError from "../utils/apiError.js";
import logger from "../utils/logger.js";

const errorHandler = (err, req, res, next) => {
  let error = err;

  // Convert Mongoose validation error
  if (err.name === "ValidationError") {
    const message = Object.values(err.errors)
      .map((val) => val.message)
      .join(", ");
    error = new ApiError(400, message);
  }

  // Convert Mongoose duplicate key error
  if (err.code === 11000) {
    const message = `Duplicate field value: ${Object.keys(err.keyValue)}`;
    error = new ApiError(400, message);
  }

  // Convert Mongoose cast error
  if (err.name === "CastError") {
    const message = `Invalid ${err.path}: ${err.value}`;
    error = new ApiError(400, message);
  }

  // JWT Errors
  if (err.name === "JsonWebTokenError") {
    error = new ApiError(401, "Invalid JSON Web Token");
  }

  if (err.name === "TokenExpiredError") {
    error = new ApiError(401, "JSON Web Token has expired");
  }

  error = error instanceof ApiError ? error : new ApiError(500, err.message);

  // Log error
  logger.error(`${error.statusCode} - ${error.message}`);

  return res.status(error.statusCode).json({
    success: false,
    message: error.message,
    errors: error.errors || [],
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};

export default errorHandler;
