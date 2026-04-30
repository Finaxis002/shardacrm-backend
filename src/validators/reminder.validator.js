import Joi from "joi";

export const createReminderValidator = Joi.object({
  leadId: Joi.string().required(),
  type: Joi.string()
    .valid("call", "follow-up", "meeting", "task", "email")
    .required(),
  assignedTo: Joi.string().optional(),
  reminderDate: Joi.date().required(),
  reminderTime: Joi.string()
    .regex(/^([0-1]\d|2[0-3]):[0-5]\d$/)
    .required(),
  note: Joi.string().optional(),
});

export const updateReminderValidator = Joi.object({
  type: Joi.string().valid("call", "follow-up", "meeting", "task", "email"),
  assignedTo: Joi.string(),
  reminderDate: Joi.date(),
  reminderTime: Joi.string().regex(/^([0-1]\d|2[0-3]):[0-5]\d$/),
  note: Joi.string(),
});

export const getRemindersValidator = Joi.object({
  page: Joi.number().optional().min(1).default(1),
  limit: Joi.number().optional().min(1).max(100).default(10),
  leadId: Joi.string().optional(),
  status: Joi.string().valid("pending", "completed").optional(),
});

export const markReminderDoneValidator = Joi.object({
  isDone: Joi.boolean().required(),
});
