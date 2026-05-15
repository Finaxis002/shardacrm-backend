import Joi from "joi";

export const createLeadValidator = Joi.object({
  name: Joi.string().required().min(2).max(100),
  phone: Joi.string()
    .required()
    .regex(/^[0-9+\s\-()]{10,}$/),
  email: Joi.string().email().optional(),
  city: Joi.string().optional(),
  source: Joi.string().optional(),
  status: Joi.string().optional(),
  dealValue: Joi.number().optional().min(0),
  product: Joi.string().optional(),
  closeDate: Joi.date().optional(),
  priority: Joi.string().valid("Normal", "High", "Urgent").optional(),
  note: Joi.string().optional().allow(""),
  assignedTo: Joi.string().optional(),
  coAssignees: Joi.array().items(Joi.string()).optional(),
  activity: Joi.object({
    type: Joi.string()
      .valid("Note", "Call", "Email", "Meeting", "Task")
      .optional(),
    text: Joi.string().optional().allow(""),
    callDuration: Joi.string().optional().allow(""),
    callDirection: Joi.string()
      .valid("Outgoing", "Incoming", "Missed")
      .optional(),
    callOutcome: Joi.string()
      .valid("Spoke", "No Answer", "Left Voicemail")
      .optional(),
    taskDueDate: Joi.date().optional(),
    taskAssignedTo: Joi.string().optional(),
    notifiedUsers: Joi.array().items(Joi.string()).optional(),
  }).optional(),
  recording: Joi.object({
    label: Joi.string().optional().allow(""),
    url: Joi.string().uri().optional().allow(""),
  }).optional(),
  payment: Joi.object({
    amount: Joi.number().min(0).required(),
    paymentMode: Joi.string()
      .valid(
        "UPI",
        "Bank Transfer",
        "Cash",
        "Cheque",
        "Razorpay",
        "Stripe",
        "PayU",
      )
      .required(),
    status: Joi.string()
      .valid("Pending", "Partial", "Paid", "Overdue", "Cancelled")
      .required(),
    reference: Joi.string().optional().allow(""),
    paymentDate: Joi.date().optional(),
  }).optional(),
  reminder: Joi.object({
    type: Joi.string()
      .valid("Call", "Email", "Meeting", "Follow-up", "Payment")
      .required(),
    assignedTo: Joi.string().required(),
    reminderDate: Joi.alternatives().try(Joi.date(), Joi.string()).required(),
    reminderTime: Joi.string().optional().allow(""),
    note: Joi.string().optional().allow(""),
    notifyUsers: Joi.array().items(Joi.string()).optional(),
  }).optional(),
  customFields: Joi.object().optional(),
});

export const updateLeadValidator = Joi.object({
  name: Joi.string().min(2).max(100),
  phone: Joi.string().regex(/^[0-9+\s\-()]{10,}$/),
  email: Joi.string().email(),
  city: Joi.string(),
  source: Joi.string().optional(),
  status: Joi.string().optional(),
  dealValue: Joi.number().min(0),
  product: Joi.string().optional(),
  closeDate: Joi.date(),
  priority: Joi.string().valid("Normal", "High", "Urgent"),
  assignedTo: Joi.string().optional(),
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
  limit: Joi.number().optional().min(1).max(100000).default(10),
  status: Joi.string().optional(),
  source: Joi.string().optional(),
  assignedTo: Joi.string().optional(),
  search: Joi.string().optional(),
  sortBy: Joi.string().optional(),
  sortOrder: Joi.string().valid("asc", "desc").optional(),
});
