import crypto from "crypto";
import mongoose from "mongoose";
import axios from "axios";
import Lead from "../models/Lead.model.js";
import WhatsappMessage from "../models/WhatsappMessage.model.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/apiError.js";
import logger from "../utils/logger.js";
import { getBaileysStatus, sendBaileysMessage, logoutBaileysSession, initBaileys, sendBaileysPresence, subscribeBaileysPresence, editBaileysMessage } from "../services/whatsapp.baileys.service.js";
import { sendBaileysMedia } from "../services/whatsapp.baileys.service.js";
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

const sendWhatsappCloudMessage = async (to, text, quotedMetaMessageId = null) => {
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
    ...(quotedMetaMessageId
      ? { context: { message_id: quotedMetaMessageId } }
      : {}),
  };

  const response = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  return response.data;
};

const sendWhatsappCloudMedia = async (to, relativeUrl, mimetype, fileName, caption = "") => {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    throw new ApiError(500, "WhatsApp Cloud API credentials are not configured");
  }

  const isImage = mimetype?.startsWith("image/");
  const isAudio = mimetype?.startsWith("audio/");
  const publicUrl = `${process.env.SERVER_BASE_URL}${relativeUrl}`;

  let mediaType;
  let mediaPayload;
  if (isAudio) {
    mediaType = "audio";
    mediaPayload = { link: publicUrl }; // Cloud API audio message caption/filename support nahi karta
  } else if (isImage) {
    mediaType = "image";
    mediaPayload = { link: publicUrl, caption };
  } else {
    mediaType = "document";
    mediaPayload = { link: publicUrl, filename: fileName, caption };
  }

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: mediaType,
    [mediaType]: mediaPayload,
  };

  const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`;
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
    .populate({
      path: "replyTo",
      select: "body direction type callType mediaName createdAt sentBy",
      populate: { path: "sentBy", select: "name email" },
    })
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

  const trimmedBody = body.trim();
  const userId = req.user?._id?.toString();
  const { isConnected: baileysConnected } = getBaileysStatus(userId);

  // Baileys se actual WhatsApp par bhi edit bhejo (agar connected hai aur message Baileys se gaya tha)
  if (baileysConnected && message.source === "baileys" && message.waMessageRaw?.key) {
    try {
      await editBaileysMessage(userId, message.phone, trimmedBody, message.waMessageRaw.key);
    } catch (err) {
      throw new ApiError(500, `Failed to edit message on WhatsApp: ${err.message}`);
    }
  }

  message.body = trimmedBody;
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
  const { leadId, message, replyToId } = req.body;
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

  const trimmedMessage = message.trim();
  const userId = req.user?._id?.toString();
  const { isConnected: baileysConnected } = getBaileysStatus(userId);

  /* ───────────────────────────────
     PATH 1 — Baileys connected: send directly, no Cloud API involved
  ─────────────────────────────── */
  if (baileysConnected) {
    try {
      let quotedRaw = null;
      if (replyToId) {
        const replyToMsg = await WhatsappMessage.findById(replyToId).lean();
        quotedRaw = replyToMsg?.waMessageRaw || null;
      }

      const waResult = await sendBaileysMessage(userId, recipient, trimmedMessage, quotedRaw);
      const waMessageId = waResult?.key?.id || "";

      const savedMessage = await WhatsappMessage.create({
        leadId: lead._id,
        organization: lead.organization,
        type: "chat",
        direction: "outgoing",
        body: trimmedMessage,
        phone: recipient,
        status: "sent",
        source: "baileys",
        metaMessageId: waMessageId,
        sentBy: req.user?._id || null,
        replyTo: replyToId || null,
        waMessageRaw: { key: waResult?.key, message: waResult?.message },
      });

      const populatedMessage = await WhatsappMessage.findById(savedMessage._id)
        .populate("sentBy", "name email")
        .populate({
          path: "replyTo",
          select: "body direction type callType mediaName createdAt sentBy",
          populate: { path: "sentBy", select: "name email" },
        })
        .lean();

      return res
        .status(200)
        .json(
          new ApiResponse(200, populatedMessage, "WhatsApp message sent successfully"),
        );
    } catch (err) {
      
      throw new ApiError(500, `Failed to send via WhatsApp (Baileys): ${err.message}`);
    }
  }

  /* ───────────────────────────────
     PATH 2 — Baileys not connected: fall back to Cloud API (old behaviour)
  ─────────────────────────────── */
  const cloudApiConfigured = Boolean(
    process.env.META_PAGE_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID,
  );

  if (!cloudApiConfigured) {
    throw new ApiError(
      400,
      "WhatsApp is not connected. Please scan the QR code to link your device before sending messages.",
    );
  }
  let quotedMetaMessageId = null;
  if (replyToId) {
    const replyToMsg = await WhatsappMessage.findById(replyToId).lean();
    quotedMetaMessageId = replyToMsg?.metaMessageId || null;
  }

  let cloudResponse;
  try {
    cloudResponse = await sendWhatsappCloudMessage(recipient, trimmedMessage, quotedMetaMessageId);
  } catch (err) {   
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
    const templateWindowError =
      /template|24(?:\s|-)?hour|customer care window|window has expired|HSM|business template/i.test(
        String(externalMessage),
      );

    if (invalidTokenError || templateWindowError) {
      const fallbackMessage = await WhatsappMessage.create({
        leadId: lead._id,
        organization: lead.organization,
        type: "chat",
        direction: "outgoing",
        body: trimmedMessage,
        phone: recipient,
        status: "failed",
        fallback: true,
        source: "cloud_api",
        metaMessageId: "",
        sentBy: req.user?._id || null,
        metaResponse: err.response?.data || { error: externalMessage },
      });

      
    }

    const errorMessage = invalidTokenError
      ? "WhatsApp API token invalid or not configured. Please check META_PAGE_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID, or connect WhatsApp via QR."
      : templateWindowError
        ? "WhatsApp can only send messages after 24 hours using a template. Please open direct WhatsApp chat or use a template message."
        : externalMessage;

    throw new ApiError(invalidTokenError ? 500 : externalStatus, errorMessage);
  }

  const metaMessageId = cloudResponse.messages?.[0]?.id || "";

  const savedMessage = await WhatsappMessage.create({
    leadId: lead._id,
    organization: lead.organization,
    type: "chat",
    direction: "outgoing",
    body: trimmedMessage,
    phone: recipient,
    status: "sent",
    source: "cloud_api",
    metaMessageId,
    sentBy: req.user?._id || null,
    metaResponse: cloudResponse,
    replyTo: replyToId || null,
  });

  const populatedMessage = await WhatsappMessage.findById(savedMessage._id)
    .populate("sentBy", "name email")
    .populate({
      path: "replyTo",
      select: "body direction type callType mediaName createdAt sentBy",
      populate: { path: "sentBy", select: "name email" },
    })
    .lean();

  res
    .status(200)
    .json(
      new ApiResponse(200, populatedMessage, "WhatsApp message sent successfully"),
    );
});

export const sendWhatsAppMedia = asyncHandler(async (req, res) => {
  const { leadId, caption, replyToId } = req.body;
  const file = req.file;

  if (!leadId || !file) {
    throw new ApiError(400, "leadId and file are required");
  }

  const lead = await Lead.findById(leadId);
  if (!lead) {
    throw new ApiError(404, "Lead not found");
  }

  const recipient = normalizePhoneNumber(lead.phone);
  if (!recipient) {
    throw new ApiError(400, "Lead phone number is invalid or missing");
  }

  const relativeUrl = `/uploads/whatsapp/${file.filename}`;
  const userId = req.user?._id?.toString();
  const { isConnected: baileysConnected } = getBaileysStatus(userId);
  const isVoiceNote = Boolean(file.mimetype?.startsWith("audio/"));
  const trimmedCaption = isVoiceNote ? "" : (caption?.trim() || "");

  if (baileysConnected) {
    try {
      let quotedRaw = null;
      if (replyToId) {
        const replyToMsg = await WhatsappMessage.findById(replyToId).lean();
        quotedRaw = replyToMsg?.waMessageRaw || null;
      }

      const waResult = await sendBaileysMedia(userId, recipient, file.path, file.originalname, file.mimetype, trimmedCaption, quotedRaw);
      const waMessageId = waResult?.key?.id || "";

      const savedMessage = await WhatsappMessage.create({
        leadId: lead._id,
        organization: lead.organization,
        type: "chat",
        direction: "outgoing",
        body: trimmedCaption,
        phone: recipient,
        status: "sent",
        source: "baileys",
        metaMessageId: waMessageId,
        sentBy: req.user?._id || null,
        mediaUrl: relativeUrl,
        mediaName: file.originalname,
        isVoiceNote,
        replyTo: replyToId || null,
        waMessageRaw: { key: waResult?.key, message: waResult?.message },
      });

      const populatedMessage = await WhatsappMessage.findById(savedMessage._id)
        .populate("sentBy", "name email")
        .populate({
          path: "replyTo",
          select: "body direction type callType mediaName createdAt sentBy",
          populate: { path: "sentBy", select: "name email" },
        })
        .lean();

      return res.status(200).json(new ApiResponse(200, populatedMessage, "Media sent successfully"));
    } catch (err) {
      throw new ApiError(500, `Failed to send media via WhatsApp (Baileys): ${err.message}`);
    }
  }

  const cloudApiConfigured = Boolean(
    process.env.META_PAGE_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID,
  );

  if (!cloudApiConfigured) {
    throw new ApiError(
      400,
      "WhatsApp is not connected. Please scan the QR code to link your device before sending files.",
    );
  }

  let cloudResponse;
  try {
    cloudResponse = await sendWhatsappCloudMedia(recipient, relativeUrl, file.mimetype, file.originalname, trimmedCaption);
  } catch (err) {
    const externalMessage = err.response?.data?.error?.message || err.message || "Failed to send media";
    throw new ApiError(err.response?.status || 500, externalMessage);
  }

  const metaMessageId = cloudResponse.messages?.[0]?.id || "";

  const savedMessage = await WhatsappMessage.create({
    leadId: lead._id,
    organization: lead.organization,
    type: "chat",
    direction: "outgoing",
    body: trimmedCaption,
    phone: recipient,
    status: "sent",
    source: "cloud_api",
    metaMessageId,
    sentBy: req.user?._id || null,
    metaResponse: cloudResponse,
    mediaUrl: relativeUrl,
    mediaName: file.originalname,
    isVoiceNote,
    replyTo: replyToId || null,
  });

  const populatedMessage = await WhatsappMessage.findById(savedMessage._id)
    .populate("sentBy", "name email")
    .populate({
      path: "replyTo",
      select: "body direction type callType mediaName createdAt sentBy",
      populate: { path: "sentBy", select: "name email" },
    })
    .lean();

  res.status(200).json(new ApiResponse(200, populatedMessage, "Media sent successfully"));
}); 

export const verifyWebhook = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
    
    return res.status(200).send(challenge);
  }

  
  return res.status(403).json({ message: "Verification failed" });
};

export const receiveWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers["x-hub-signature-256"];
  const rawBody = req.rawBody || JSON.stringify(req.body);

  if (!verifySignature(rawBody, signature)) {
    
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
           
            continue;
          }

          const savedWebhookMsg = await WhatsappMessage.create({
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

          if (savedWebhookMsg.type === "chat") {
            const io = req.app.get("io");
            if (io) io.emit("wa-unread-new", { leadId: lead._id.toString() });
          }
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
    
  }
});
export const logoutWhatsApp = asyncHandler(async (req, res) => {
  const userId = req.user?._id?.toString();
  const { isConnected: baileysConnected } = getBaileysStatus(userId);

  if (!baileysConnected) {
    throw new ApiError(400, "WhatsApp is not currently connected");
  }

  try {
    await logoutBaileysSession(userId);
  } catch (err) {
    throw new ApiError(500, `Failed to logout WhatsApp: ${err.message}`);
  }

  res
    .status(200)
    .json(new ApiResponse(200, null, "WhatsApp logged out successfully"));
});
export const connectWhatsApp = asyncHandler(async (req, res) => {
  const userId = req.user?._id?.toString();
  const { isConnected: baileysConnected } = getBaileysStatus(userId);

  if (baileysConnected) {
    return res
      .status(200)
      .json(new ApiResponse(200, null, "WhatsApp already connected"));
  }

  const io = req.app.get("io");   // ⬅️ neeche note dekho
  initBaileys(io, userId);

  res
    .status(200)
    .json(new ApiResponse(200, null, "WhatsApp connection initiated"));
});

export const getWhatsAppStatus = asyncHandler(async (req, res) => {
  const userId = req.user?._id?.toString();
  const status = getBaileysStatus(userId);

  res
    .status(200)
    .json(new ApiResponse(200, status, "WhatsApp status fetched"));
});
export const getUnreadCounts = asyncHandler(async (req, res) => {
  const { leadIds } = req.body;
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(200).json(new ApiResponse(200, {}, "No leadIds provided"));
  }

  const validIds = leadIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const results = await WhatsappMessage.aggregate([
    {
      $match: {
        leadId: { $in: validIds },
        direction: "incoming",
        type: "chat",
        readByAgent: false,
      },
    },
    { $group: { _id: "$leadId", count: { $sum: 1 } } },
  ]);

  const counts = {};
  results.forEach((r) => {
    counts[r._id.toString()] = r.count;
  });

  res.status(200).json(new ApiResponse(200, counts, "Unread counts fetched"));
});

export const markMessagesRead = asyncHandler(async (req, res) => {
  const { leadId } = req.params;
  if (!leadId) {
    throw new ApiError(400, "leadId is required");
  }

  await WhatsappMessage.updateMany(
    { leadId, direction: "incoming", type: "chat", readByAgent: false },
    { $set: { readByAgent: true } },
  );

  const io = req.app.get("io");
  if (io) {
    io.emit("wa-unread-cleared", { leadId });
  }

  res.status(200).json(new ApiResponse(200, null, "Messages marked as read"));
});

export const sendTypingStatus = asyncHandler(async (req, res) => {
  const { leadId, state } = req.body; // state: "composing" | "paused" | "recording"
  if (!leadId || !state) {
    throw new ApiError(400, "leadId and state are required");
  }

  const lead = await Lead.findById(leadId).lean();
  if (!lead) {
    throw new ApiError(404, "Lead not found");
  }

  const recipient = normalizePhoneNumber(lead.phone);
  const userId = req.user?._id?.toString();
  const { isConnected: baileysConnected } = getBaileysStatus(userId);

  if (baileysConnected && recipient) {
    // Typing presence sirf Baileys (self-hosted) mein kaam karta hai, Cloud API isko expose nahi karta
    sendBaileysPresence(userId, recipient, state).catch(() => {});
  }

  res.status(200).json(new ApiResponse(200, null, "Typing status sent"));
});

export const subscribePresence = asyncHandler(async (req, res) => {
  const { leadId } = req.body;
  if (!leadId) {
    throw new ApiError(400, "leadId is required");
  }

  const lead = await Lead.findById(leadId).lean();
  if (!lead) {
    throw new ApiError(404, "Lead not found");
  }

  const recipient = normalizePhoneNumber(lead.phone);
  const userId = req.user?._id?.toString();
  const { isConnected: baileysConnected } = getBaileysStatus(userId);

  if (baileysConnected && recipient) {
    subscribeBaileysPresence(userId, recipient).catch(() => {});
  }

  res.status(200).json(new ApiResponse(200, null, "Presence subscribed"));
});
