import Joi from "joi";

export const createTeamMemberValidator = Joi.object({
  name: Joi.string().required().min(2).max(50),
  email: Joi.string().email().required(),
  password: Joi.string().required().min(6).max(30),
  phone: Joi.string()
    .optional()
    .regex(/^[0-9]{10}$/),
  role: Joi.string()
    .valid("admin", "manager", "tl", "exec", "viewer")
    .optional(),
});

export const updateUserValidator = Joi.object({
  name: Joi.string().min(2).max(50),
  phone: Joi.string().regex(/^[0-9]{10}$/),
  role: Joi.string().valid("admin", "manager", "tl", "exec", "viewer"),
  password: Joi.string().min(6).max(30),
});

export const updateUserRoleValidator = Joi.object({
  role: Joi.string()
    .valid("admin", "manager", "tl", "exec", "viewer")
    .required(),
});

export const updateUserPermissionsValidator = Joi.object({
  permissions: Joi.object().required(),
});

export const getTeamMembersValidator = Joi.object({
  page: Joi.number().optional().min(1).default(1),
  limit: Joi.number().optional().min(1).max(100).default(10),
  role: Joi.string().optional(),
  search: Joi.string().optional(),
});
