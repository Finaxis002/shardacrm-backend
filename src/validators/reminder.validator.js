import Joi from "joi";

export const createReminderValidator = Joi.object({
  leadId: Joi.string().required(),
  type: Joi.string()
    .valid(
      "Call",
      "Email",
      "Meeting",
      "Follow-up",
      "Payment",
      "call",
      "email",
      "meeting",
      "follow-up",
      "payment",
    )
    .required(),
  assignedTo: Joi.string().optional(),
  reminderDate: Joi.date().required(),
  reminderTime: Joi.string()
    .regex(/^([0-1]\d|2[0-3]):[0-5]\d$/)
    .required(),
  note: Joi.string().optional(),
  notifyUsers: Joi.alternatives()
    .try(Joi.string(), Joi.array().items(Joi.string()))
    .optional(),
});

export const updateReminderValidator = Joi.object({
  type: Joi.string().valid(
    "Call",
    "Email",
    "Meeting",
    "Follow-up",
    "Payment",
    "call",
    "email",
    "meeting",
    "follow-up",
    "payment",
  ),
  assignedTo: Joi.string(),
  reminderDate: Joi.date(),
  reminderTime: Joi.string().regex(/^([0-1]\d|2[0-3]):[0-5]\d$/),
  note: Joi.string(),
  notifyUsers: Joi.alternatives()
    .try(Joi.string(), Joi.array().items(Joi.string()))
    .optional(),
});

export const getRemindersValidator = Joi.object({
  page: Joi.number().optional().min(1).default(1),
  limit:  Joi.number().optional().min(1).max(5000).default(1000),
  leadId: Joi.string().optional(),
  status: Joi.string().valid("pending", "completed").optional(),
});

export const markReminderDoneValidator = Joi.object({
  isDone: Joi.boolean().required(),
});
