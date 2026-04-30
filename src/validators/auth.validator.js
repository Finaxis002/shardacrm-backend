import Joi from "joi";

export const registerValidator = Joi.object({
  name: Joi.string().required().min(2).max(50),
  email: Joi.string().email().required(),
  password: Joi.string().required().min(6).max(30),
  phone: Joi.string()
    .optional()
    .regex(/^[0-9]{10}$/),
  companyName: Joi.string().required().min(2).max(100),
});

export const loginValidator = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

export const updateProfileValidator = Joi.object({
  name: Joi.string().min(2).max(50),
  phone: Joi.string()
    .optional()
    .regex(/^[0-9]{10}$/),
  avatar: Joi.string().optional().uri(),
});

export const refreshTokenValidator = Joi.object({
  refreshToken: Joi.string().required(),
});
