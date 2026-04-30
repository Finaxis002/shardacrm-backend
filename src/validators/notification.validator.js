import Joi from "joi";

export const getNotificationsValidator = Joi.object({
  page: Joi.number().optional().min(1).default(1),
  limit: Joi.number().optional().min(1).max(100).default(10),
  isRead: Joi.boolean().optional(),
});

export const createNotificationValidator = Joi.object({
  recipientId: Joi.string().required(),
  senderId: Joi.string().required(),
  leadId: Joi.string().optional(),
  title: Joi.string().required(),
  message: Joi.string().required(),
  type: Joi.string()
    .valid(
      "assignment",
      "status_change",
      "payment",
      "reminder",
      "mention",
      "system",
    )
    .required(),
  actionUrl: Joi.string().optional(),
});
