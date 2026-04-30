import Joi from "joi";

export const createActivityValidator = Joi.object({
  leadId: Joi.string().required(),
  type: Joi.string()
    .valid("call", "note", "email", "meeting", "task", "recording")
    .required(),
  text: Joi.string().optional(),
  callDuration: Joi.number().optional().min(0),
  callDirection: Joi.string().valid("inbound", "outbound").optional(),
  callOutcome: Joi.string().optional(),
  recordingUrl: Joi.string().uri().optional(),
  taskDueDate: Joi.date().optional(),
  taskAssignedTo: Joi.string().optional(),
});

export const updateActivityValidator = Joi.object({
  text: Joi.string().optional(),
  callDuration: Joi.number().optional().min(0),
  callOutcome: Joi.string().optional(),
  taskDueDate: Joi.date().optional(),
  taskAssignedTo: Joi.string().optional(),
});

export const getActivitiesValidator = Joi.object({
  leadId: Joi.string().optional(),
  type: Joi.string().optional(),
  page: Joi.number().optional().min(1).default(1),
  limit: Joi.number().optional().min(1).max(100).default(10),
});
