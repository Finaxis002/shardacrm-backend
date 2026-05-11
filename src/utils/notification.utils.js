import webPush from "web-push";
import PushSubscription from "../models/PushSubscription.model.js";
import Notification from "../models/Notification.model.js";
import { config } from "../config/env.js";

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

const vapidConfigured = Boolean(
  config.vapid?.publicKey && config.vapid?.privateKey,
);

if (vapidConfigured) {
  webPush.setVapidDetails(
    config.vapid.contact || "mailto:bdefinaxis@gmail.com",
    config.vapid.publicKey,
    config.vapid.privateKey,
  );
}

const triggerPushNotification = async (
  recipientIds,
  title,
  message,
  actionUrl,
) => {
  if (
    !Array.isArray(recipientIds) ||
    !recipientIds.length ||
    !vapidConfigured
  ) {
    return;
  }

  const subscriptions = await PushSubscription.find({
    user: { $in: recipientIds },
  }).lean();

  if (!subscriptions.length) {
    return;
  }

  const payload = JSON.stringify({
    title,
    body: message,
    url: actionUrl || "/",
  });

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webPush.sendNotification(subscription, payload);
      } catch (error) {
        const statusCode = error?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await PushSubscription.deleteOne({ _id: subscription._id });
          return;
        }
        console.error(
          "Push notification delivery failed for subscription",
          subscription.endpoint,
          error,
        );
      }
    }),
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

  const savedNotification = await notification.save();

  if (vapidConfigured) {
    triggerPushNotification(
      [String(recipientId)],
      title,
      message,
      actionUrl,
    ).catch((error) => {
      console.error("Failed to send push notification:", error);
    });
  }

  return savedNotification;
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

  if (vapidConfigured) {
    triggerPushNotification(normalizedIds, title, message, actionUrl).catch(
      (error) => {
        console.error("Failed to send push notifications:", error);
      },
    );
  }

  return docs;
};
