import ApiError from "../utils/apiError.js";
import logger from "../utils/logger.js";

/**
 * Validation middleware to validate request data
 * @param {Joi.Schema} schema - Joi validation schema
 * @param {string} source - Where to validate (body, query, params)
 */
export const validateRequest = (schema, source = "body") => {
  return (req, res, next) => {
    const dataToValidate = req[source];

    const { error, value } = schema.validate(dataToValidate, {
      abortEarly: false,
      allowUnknown: true,
      stripUnknown: false,
    });

    if (error) {
      const messages = error.details.map((d) => d.message);
      logger.warn(`Validation error: ${messages.join(", ")}`);
      throw new ApiError(400, `Validation error: ${messages.join(", ")}`);
    }

    // Replace original data with validated data
    req[source] = value;
    next();
  };
};
