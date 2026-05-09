import Joi from "joi";

export const createPaymentValidator = Joi.object({
  leadId: Joi.string().required(),
  amount: Joi.number().required().min(0),
  currency: Joi.string().optional().default("INR"),
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
    .valid("Pending", "Completed", "Partial", "Overdue", "Failed", "Paid", "Cancelled")
    .optional(),
  reference: Joi.string().optional().allow(""),
  paymentDate: Joi.date().optional(),
  dueDate: Joi.date().optional(),
  description: Joi.string().optional().allow(""),
});

export const updatePaymentValidator = Joi.object({
  amount: Joi.number().min(0),
  paymentMode: Joi.string().valid(
    "UPI",
    "Bank Transfer",
    "Cash",
    "Cheque",
    "Razorpay",
    "Stripe",
    "PayU",
  ),
  status: Joi.string().valid(
    "Pending",
    "Completed",
    "Partial",
    "Overdue",
    "Failed",
    "Paid",
    "Cancelled",
  ),
  reference: Joi.string().allow(""),
  paymentDate: Joi.date(),
  dueDate: Joi.date(),
  description: Joi.string().allow(""),
});

// generate-link 
export const generatePaymentLinkValidator = Joi.object({
  description: Joi.string().optional().allow(""),
});

export const getPaymentsValidator = Joi.object({
  page: Joi.number().optional().min(1).default(1),
  limit: Joi.number().optional().min(1).max(100).default(10),
  status: Joi.string().optional(),
  leadId: Joi.string().optional(),
});