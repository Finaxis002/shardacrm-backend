import crypto from "crypto";
import axios from "axios";
import Lead from "../models/Lead.model.js";
import WhatsappMessage from "../models/WhatsappMessage.model.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/apiError.js";
import logger from "../utils/logger.js";

const normalizePhoneNumber = (phone) => {
  if (!phone) return "";
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0"))
    return `91${digits.slice(1)}`;
  return digits;
};

const verifySignature = (rawBody, signature) => {
  if (!process.env.META_APP_SECRET) return true;
  if (!signature) return false;

  const expected = `sha256=${crypto
    .createHmac("sha256", process.env.META_APP_SECRET)
    .update(rawBody)
    .digest("hex")}`;

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
};

const sendWhatsappCloudMessage = async (to, text) => {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    throw new ApiError(
      500,
      "WhatsApp Cloud API credentials are not configured",
    );
  }

  const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: {
      body: text,
    },
  };

  const response = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  return response.data;
};

const findLeadByPhone = async (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  return Lead.findOne({ phone: { $regex: `${digits}$` } }).lean();
};

export const getWhatsAppMessages = asyncHandler(async (req, res) => {
  const leadId = req.query.leadId;
  if (!leadId) {
    throw new ApiError(400, "leadId query parameter is required");
  }

  const lead = await Lead.findById(leadId).lean();
  if (!lead) {
    throw new ApiError(404, "Lead not found");
  }

  const messages = await WhatsappMessage.find({ leadId })
    .sort({ createdAt: 1 })
    .populate("sentBy", "name email")
    .lean();

  res
    .status(200)
    .json(
      new ApiResponse(200, messages, "WhatsApp messages fetched successfully"),
    );
});

export const updateWhatsAppMessage = asyncHandler(async (req, res) => {
  const messageId = req.params.id;
  const { body } = req.body;

  if (!messageId) {
    throw new ApiError(400, "Message ID is required");
  }
  if (!body?.trim()) {
    throw new ApiError(400, "Message body cannot be empty");
  }

  const message = await WhatsappMessage.findById(messageId);
  if (!message) {
    throw new ApiError(404, "WhatsApp message not found");
  }
  if (message.direction !== "outgoing") {
    throw new ApiError(403, "Only outgoing messages can be edited");
  }

  message.body = body.trim();
  await message.save();

  const updated = await WhatsappMessage.findById(messageId)
    .populate("sentBy", "name email")
    .lean();

  res
    .status(200)
    .json(new ApiResponse(200, updated, "WhatsApp message updated"));
});

export const deleteWhatsAppMessage = asyncHandler(async (req, res) => {
  const messageId = req.params.id;
  if (!messageId) {
    throw new ApiError(400, "Message ID is required");
  }

  const message = await WhatsappMessage.findById(messageId);
  if (!message) {
    throw new ApiError(404, "WhatsApp message not found");
  }
  if (message.direction !== "outgoing") {
    throw new ApiError(403, "Only outgoing messages can be deleted");
  }

  await WhatsappMessage.deleteOne({ _id: messageId });

  res.status(200).json(new ApiResponse(200, null, "WhatsApp message deleted"));
});

export const sendWhatsAppMessage = asyncHandler(async (req, res) => {
  const { leadId, message } = req.body;
  if (!leadId || !message?.trim()) {
    throw new ApiError(400, "leadId and message are required");
  }

  const lead = await Lead.findById(leadId);
  if (!lead) {
    throw new ApiError(404, "Lead not found");
  }

  const recipient = normalizePhoneNumber(lead.phone);
  if (!recipient) {
    throw new ApiError(400, "Lead phone number is invalid or missing");
  }

  let cloudResponse;
  try {
    cloudResponse = await sendWhatsappCloudMessage(recipient, message.trim());
  } catch (err) {
    logger.error(`WhatsApp send failed: ${err.message}`);
    const externalMessage =
      err.response?.data?.error?.message ||
      err.message ||
      "Failed to send WhatsApp message";
    const externalStatus = err.response?.status || 500;
    const invalidTokenError =
      externalStatus === 401 &&
      /invalid oauth access token|cannot parse access token/i.test(
        String(externalMessage),
      );

    if (invalidTokenError) {
      const fallbackMessage = await WhatsappMessage.create({
        leadId: lead._id,
        organization: lead.organization,
        type: "chat",
        direction: "outgoing",
        body: message.trim(),
        phone: recipient,
        status: "failed",
        fallback: true,
        metaMessageId: "",
        sentBy: req.user?._id || null,
        metaResponse: err.response?.data || { error: externalMessage },
      });

      logger.info(
        `Saved fallback WhatsApp record for lead ${lead._id}: ${fallbackMessage._id}`,
      );
    }

    throw new ApiError(
      invalidTokenError ? 500 : externalStatus,
      invalidTokenError
        ? "WhatsApp API token invalid or not configured. Please check META_PAGE_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID."
        : externalMessage,
    );
  }

  const metaMessageId = cloudResponse.messages?.[0]?.id || "";

  const savedMessage = await WhatsappMessage.create({
    leadId: lead._id,
    organization: lead.organization,
    type: "chat",
    direction: "outgoing",
    body: message.trim(),
    phone: recipient,
    status: "sent",
    metaMessageId,
    sentBy: req.user?._id || null,
    metaResponse: cloudResponse,
  });

  res
    .status(200)
    .json(
      new ApiResponse(200, savedMessage, "WhatsApp message sent successfully"),
    );
});

export const verifyWebhook = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
    logger.info("WhatsApp webhook verified successfully");
    return res.status(200).send(challenge);
  }

  logger.warn("WhatsApp webhook verification failed — token mismatch");
  return res.status(403).json({ message: "Verification failed" });
};

export const receiveWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers["x-hub-signature-256"];
  const rawBody = req.rawBody || JSON.stringify(req.body);

  if (!verifySignature(rawBody, signature)) {
    logger.warn("WhatsApp webhook: invalid signature");
    return res.status(401).json({ message: "Invalid signature" });
  }

  const body = req.body;
  if (body.object !== "whatsapp_business_account") {
    return res.status(200).json({ message: "Ignored" });
  }

  res.status(200).json({ message: "Received" });

  try {
    for (const entry of Array.isArray(body.entry) ? body.entry : []) {
      for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
        const value = change.value || {};
        const messages = Array.isArray(value.messages) ? value.messages : [];
        const statuses = Array.isArray(value.statuses) ? value.statuses : [];

        for (const message of messages) {
          const messageId = message.id || "";
          if (!messageId) continue;

          const alreadyExists = await WhatsappMessage.findOne({
            metaMessageId: messageId,
          });
          if (alreadyExists) continue;

          const from = message.from;
          const text =
            message.text?.body ||
            message.interactive?.button_reply?.title ||
            message.interactive?.list_reply?.title ||
            "";
          const lead = await findLeadByPhone(from);

          if (!lead) {
            logger.warn(
              `Incoming WhatsApp message from unknown sender: ${from}`,
            );
            continue;
          }

          await WhatsappMessage.create({
            leadId: lead._id,
            organization: lead.organization,
            type: message.type === "call" ? "call" : "chat",
            direction: "incoming",
            body: text,
            phone: normalizePhoneNumber(from),
            status: "received",
            metaMessageId: messageId,
            metaResponse: message,
          });
        }

        for (const statusObj of statuses) {
          const statusId = statusObj.id || "";
          const currentStatus = statusObj.status || "";
          if (!statusId || !currentStatus) continue;

          await WhatsappMessage.updateOne(
            { metaMessageId: statusId },
            {
              $set: {
                status: currentStatus,
                metaResponse: statusObj,
              },
            },
          );
        }
      }
    }
  } catch (err) {
    logger.error(`WhatsApp webhook processing failed: ${err.message}`);
  }
});
