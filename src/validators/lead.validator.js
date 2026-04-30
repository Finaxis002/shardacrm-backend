import Joi from "joi";

export const createLeadValidator = Joi.object({
  name: Joi.string().required().min(2).max(100),
  phone: Joi.string()
    .required()
    .regex(/^[0-9+\s\-()]{10,}$/),
  email: Joi.string().email().optional(),
  city: Joi.string().optional(),
  source: Joi.string()
    .valid(
      "Direct",
      "Referral",
      "Website",
      "LinkedIn",
      "Phone",
      "Email",
      "Event",
      "Other",
    )
    .optional(),
  status: Joi.string()
    .valid("New", "Interested", "Details Shared", "Success", "Closed")
    .optional(),
  dealValue: Joi.number().optional().min(0),
  product: Joi.array().items(Joi.string()).optional(),
  closeDate: Joi.date().optional(),
  priority: Joi.string().valid("Low", "Medium", "High").optional(),
  assignedTo: Joi.string().optional(),
  customFields: Joi.object().optional(),
});

export const updateLeadValidator = Joi.object({
  name: Joi.string().min(2).max(100),
  phone: Joi.string().regex(/^[0-9+\s\-()]{10,}$/),
  email: Joi.string().email(),
  city: Joi.string(),
  source: Joi.string().valid(
    "Direct",
    "Referral",
    "Website",
    "LinkedIn",
    "Phone",
    "Email",
    "Event",
    "Other",
  ),
  status: Joi.string().valid(
    "New",
    "Interested",
    "Details Shared",
    "Success",
    "Closed",
  ),
  dealValue: Joi.number().min(0),
  product: Joi.array().items(Joi.string()),
  closeDate: Joi.date(),
  priority: Joi.string().valid("Low", "Medium", "High"),
  customFields: Joi.object(),
});

export const assignLeadValidator = Joi.object({
  assignedTo: Joi.string().required(),
});

export const updateLeadStatusValidator = Joi.object({
  status: Joi.string()
    .valid("New", "Interested", "Details Shared", "Success", "Closed")
    .required(),
});

export const searchLeadsValidator = Joi.object({
  page: Joi.number().optional().min(1).default(1),
  limit: Joi.number().optional().min(1).max(100).default(10),
  status: Joi.string().optional(),
  source: Joi.string().optional(),
  assignedTo: Joi.string().optional(),
  search: Joi.string().optional(),
  sortBy: Joi.string().optional(),
  sortOrder: Joi.string().valid("asc", "desc").optional(),
});
