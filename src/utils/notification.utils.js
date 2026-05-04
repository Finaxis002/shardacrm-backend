import Notification from "../models/Notification.model.js";

const extractId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if (value._id) return String(value._id);
    if (value.id) return String(value.id);
    const stringValue = value.toString?.();
    if (stringValue && !stringValue.startsWith("[object")) return stringValue;
    return "";
  }
  return String(value);
};

const normalizeRecipientIds = (
  recipientIds,
  senderId,
  excludeSender = true,
) => {
  if (!recipientIds) return [];

  const ids = Array.isArray(recipientIds) ? recipientIds : [recipientIds];

  return Array.from(
    new Set(
      ids
        .map((id) => extractId(id))
        .filter(Boolean)
        .filter((id) =>
          excludeSender ? extractId(id) !== extractId(senderId) : true,
        ),
    ),
  );
};

export const createNotification = async ({
  recipientId,
  senderId,
  organization,
  leadId,
  title,
  message,
  type = "system",
  actionUrl,
}) => {
  if (!recipientId) {
    throw new Error("recipientId is required to create a notification");
  }

  const notification = new Notification({
    recipientId,
    senderId,
    organization,
    leadId,
    title,
    message,
    type,
    actionUrl,
  });

  return notification.save();
};

export const createNotifications = async ({
  recipientIds,
  senderId,
  organization,
  leadId,
  title,
  message,
  type = "system",
  actionUrl,
  excludeSender = true,
}) => {
  const normalizedIds = normalizeRecipientIds(
    recipientIds,
    senderId,
    excludeSender,
  );

  if (!normalizedIds.length) {
    return [];
  }

  const notifications = normalizedIds.map((recipientId) => ({
    recipientId,
    senderId,
    organization,
    leadId,
    title,
    message,
    type,
    actionUrl,
  }));

  const docs = await Notification.insertMany(notifications);
  return docs;
};
