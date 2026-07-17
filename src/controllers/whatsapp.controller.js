import crypto from "crypto";
import mongoose from "mongoose";
import axios from "axios";
import Lead from "../models/Lead.model.js";
import User from "../models/User.model.js";
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
  return Lead.findOne({ phone: { $regex: `${digits}$` } })
    .sort({ createdAt: -1 }) // duplicate Leads (same phone) ho to hamesha sabse recent wali uthao
    .lean();
};

export const getWhatsAppMessages = asyncHandler(async (req, res) => {
  const { leadId, phone, groupJid, agentUserId } = req.query;
  if (!leadId && !phone && !groupJid) {
    throw new ApiError(400, "leadId, phone, or groupJid query parameter is required");
  }

  let messageQuery;

  if (groupJid) {
    // Group conversation — exact groupJid match, phone-regex logic yahan lagu nahi hoti
    messageQuery = { phone: groupJid, isGroup: true };
  } else {
    // ── Phone hi asli conversation identity hai — leadId nahi.
    //    (Duplicate Leads same phone number ke saath exist kar sakti hain, aur
    //    alag-alag messages alag-alag duplicate Lead se tag ho sakte hain.
    //    Isliye leadId diya ho to pehle uska phone nikal ke, phone se hi
    //    saare messages fetch karo — taaki koi bhi duplicate-tagged message
    //    miss na ho aur galti se doosre Lead ka data mix na ho.)
    let last10;
    if (leadId) {
      const lead = await Lead.findById(leadId).lean();
      if (!lead) {
        throw new ApiError(404, "Lead not found");
      }
      last10 = String(lead.phone || "").replace(/\D/g, "").slice(-10);
    } else {
      last10 = String(phone).replace(/\D/g, "").slice(-10);
    }

    if (!last10) {
      throw new ApiError(400, "Could not resolve a valid phone number");
    }

    messageQuery = { phone: { $regex: `${last10}$` } };
  }

  // ── Sirf apna WhatsApp session (waUserId) ke messages dikhao —
  //    admin/manager sabka dekh sakte hain, executive sirf apna
  const currentUser = req.user;
  const isPrivileged = currentUser?.role === "admin" || currentUser?.role === "manager";

  if (!isPrivileged) {
    const uid = new mongoose.Types.ObjectId(currentUser._id);
    messageQuery.$or = [{ waUserId: uid }, { sentBy: uid }];
  } else if (agentUserId) {
    const aid = new mongoose.Types.ObjectId(agentUserId);
    messageQuery.$or = [{ waUserId: aid }, { sentBy: aid }];
  }

  const messages = await WhatsappMessage.find(messageQuery)
    .select("-waMessageRaw") // bahut bada binary media-metadata hota hai, frontend ko iski zaroorat nahi
    .sort({ createdAt: 1 })
    .populate("sentBy", "name email")
    .populate("waUserId", "name email")
    .populate({
      path: "replyTo",
      select: "body direction type callType mediaName createdAt sentBy waUserId",
      populate: [
        { path: "sentBy", select: "name email" },
        { path: "waUserId", select: "name email" },
      ],
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

  // WhatsApp jaisa hi edit window — sirf 15 minute tak edit allow hai
  const EDIT_WINDOW_MS = 15 * 60 * 1000;
  const messageAge = Date.now() - new Date(message.createdAt).getTime();
  if (messageAge > EDIT_WINDOW_MS) {
    throw new ApiError(403, "This message can no longer be edited (edit window of 15 minutes has expired)");
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
    .populate("waUserId", "name email")
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
  const { leadId, phone: rawPhone, groupJid, message, replyToId, sendAsUserId } = req.body;
  if ((!leadId && !rawPhone && !groupJid) || !message?.trim()) {
    throw new ApiError(400, "leadId, phone, or groupJid, and message are required");
  }

  let lead = null;
  let recipient = null;
  let recipientJid = null;

  if (groupJid) {
    recipientJid = String(groupJid);
    recipient = recipientJid;
  } else if (leadId) {
    lead = await Lead.findById(leadId);
    if (!lead) {
      throw new ApiError(404, "Lead not found");
    }
    recipient = normalizePhoneNumber(lead.phone);
  } else {
    recipient = normalizePhoneNumber(rawPhone);
    // Isi phone ka koi Lead already exist karta ho to use bhi (optional) link kar do
    lead = await findLeadByPhone(recipient);
  }

  if (!recipient) {
    throw new ApiError(400, "Recipient phone number is invalid or missing");
  }

  const trimmedMessage = message.trim();
  // sendAsUserId diya ho to us agent ke apne connected session se bhejo
  const userId = sendAsUserId || req.user?._id?.toString();
  const { isConnected: baileysConnected } = getBaileysStatus(userId);

  if (sendAsUserId && !baileysConnected) {
    throw new ApiError(400, "Selected agent's WhatsApp is not connected right now.");
  }

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

      const waResult = await sendBaileysMessage(userId, recipientJid || recipient, trimmedMessage, quotedRaw);
      const waMessageId = waResult?.key?.id || "";

      // Atomic upsert — agar Baileys ka apna self-echo event pehle hi ek record bana chuka ho
      // (metaMessageId match karke), to yahan sirf sentBy/status update ho jayega, duplicate nahi banega.
      const organization = lead?.organization || req.user?.organization;
      const savedMessage = await WhatsappMessage.findOneAndUpdate(
        { metaMessageId: waMessageId },
        {
          $setOnInsert: {
            leadId: lead?._id || null,
            organization,
            type: "chat",
            direction: "outgoing",
            body: trimmedMessage,
            phone: recipientJid || recipient,
            source: "baileys",
            metaMessageId: waMessageId,
            replyTo: replyToId || null,
            waMessageRaw: { key: waResult?.key, message: waResult?.message },
            isGroup: Boolean(groupJid),
            groupJid: groupJid || null,
            groupSubject: groupJid ? "" : "",
          },
          $set: {
            status: "sent",
            sentBy: sendAsUserId || req.user?._id || null,
            waUserId: userId,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      const populatedMessage = await WhatsappMessage.findById(savedMessage._id)
        .populate("sentBy", "name email")
        .populate("waUserId", "name email")
        .populate({
          path: "replyTo",
          select: "body direction type callType mediaName createdAt sentBy waUserId",
          populate: [
            { path: "sentBy", select: "name email" },
            { path: "waUserId", select: "name email" },
          ],
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
  if (!lead) {
    throw new ApiError(
      400,
      "WhatsApp (personal session) is not connected. Cloud API fallback needs a linked Lead, which this contact doesn't have.",
    );
  }

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
    phone: recipientJid || recipient,
    status: "sent",
    source: "cloud_api",
    metaMessageId,
    sentBy: req.user?._id || null,
    metaResponse: cloudResponse,
    replyTo: replyToId || null,
    isGroup: Boolean(groupJid),
    groupJid: groupJid || null,
  });

  const populatedMessage = await WhatsappMessage.findById(savedMessage._id)
    .populate("sentBy", "name email")
    .populate("waUserId", "name email")
    .populate({
      path: "replyTo",
      select: "body direction type callType mediaName createdAt sentBy waUserId",
      populate: [
        { path: "sentBy", select: "name email" },
        { path: "waUserId", select: "name email" },
      ],
    })
    .lean();

  res
    .status(200)
    .json(
      new ApiResponse(200, populatedMessage, "WhatsApp message sent successfully"),
    );
});

export const sendWhatsAppMedia = asyncHandler(async (req, res) => {
  const { leadId, phone: rawPhone, caption, replyToId, sendAsUserId } = req.body;
  const file = req.file;

  if ((!leadId && !rawPhone) || !file) {
    throw new ApiError(400, "leadId or phone, and file are required");
  }

  let lead = null;
  let recipient = null;

  if (leadId) {
    lead = await Lead.findById(leadId);
    if (!lead) {
      throw new ApiError(404, "Lead not found");
    }
    recipient = normalizePhoneNumber(lead.phone);
  } else {
    recipient = normalizePhoneNumber(rawPhone);
    lead = await findLeadByPhone(recipient);
  }

  if (!recipient) {
    throw new ApiError(400, "Recipient phone number is invalid or missing");
  }

  const relativeUrl = `/uploads/whatsapp/${file.filename}`;
  const userId = sendAsUserId || req.user?._id?.toString();
  const { isConnected: baileysConnected } = getBaileysStatus(userId);

  if (sendAsUserId && !baileysConnected) {
    throw new ApiError(400, "Selected agent's WhatsApp is not connected right now.");
  }
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

      const organization = lead?.organization || req.user?.organization;
      const savedMessage = await WhatsappMessage.findOneAndUpdate(
        { metaMessageId: waMessageId },
        {
          $setOnInsert: {
            leadId: lead?._id || null,
            organization,
            type: "chat",
            direction: "outgoing",
            body: trimmedCaption,
            phone: recipient,
            source: "baileys",
            metaMessageId: waMessageId,
            mediaUrl: relativeUrl,
            mediaName: file.originalname,
            isVoiceNote,
            replyTo: replyToId || null,
            waMessageRaw: { key: waResult?.key, message: waResult?.message },
          },
          $set: {
            status: "sent",
            sentBy: sendAsUserId || req.user?._id || null,
            waUserId: userId,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      const populatedMessage = await WhatsappMessage.findById(savedMessage._id)
        .populate("sentBy", "name email")
        .populate("waUserId", "name email")
        .populate({
          path: "replyTo",
          select: "body direction type callType mediaName createdAt sentBy waUserId",
          populate: [
            { path: "sentBy", select: "name email" },
            { path: "waUserId", select: "name email" },
          ],
        })
        .lean();

      return res.status(200).json(new ApiResponse(200, populatedMessage, "Media sent successfully"));
    } catch (err) {
      throw new ApiError(500, `Failed to send media via WhatsApp (Baileys): ${err.message}`);
    }
  }

  if (!lead) {
    throw new ApiError(
      400,
      "WhatsApp (personal session) is not connected. Cloud API fallback needs a linked Lead, which this contact doesn't have.",
    );
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
    .populate("waUserId", "name email")
    .populate({
      path: "replyTo",
      select: "body direction type callType mediaName createdAt sentBy waUserId",
      populate: [
        { path: "sentBy", select: "name email" },
        { path: "waUserId", select: "name email" },
      ],
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

export const getBulkWhatsAppStatus = asyncHandler(async (req, res) => {
  const { userIds } = req.query;
  if (!userIds) {
    return res
      .status(200)
      .json(new ApiResponse(200, {}, "No userIds provided"));
  }

  const ids = String(userIds).split(",").filter(Boolean);
  const statusMap = {};
  ids.forEach((id) => {
    statusMap[id] = getBaileysStatus(id).isConnected;
  });

  res
    .status(200)
    .json(new ApiResponse(200, statusMap, "Bulk WhatsApp status fetched"));
});
export const getUnreadCounts = asyncHandler(async (req, res) => {
  const { leadIds, phones } = req.body;
  const hasLeadIds = Array.isArray(leadIds) && leadIds.length > 0;
  const hasPhones = Array.isArray(phones) && phones.length > 0;

  if (!hasLeadIds && !hasPhones) {
    return res.status(200).json(new ApiResponse(200, {}, "No leadIds or phones provided"));
  }

  const orConditions = [];
  if (hasLeadIds) {
    const validIds = leadIds
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    if (validIds.length > 0) orConditions.push({ leadId: { $in: validIds } });
  }
  if (hasPhones) {
    const normalizedPhones = phones
      .map((p) => String(p).replace(/\D/g, "").slice(-10))
      .filter(Boolean);
    if (normalizedPhones.length > 0) {
      orConditions.push({
        leadId: null,
        phone: { $regex: `(${normalizedPhones.join("|")})$` },
      });
    }
  }

  if (orConditions.length === 0) {
    return res.status(200).json(new ApiResponse(200, {}, "No valid identifiers provided"));
  }

  const results = await WhatsappMessage.aggregate([
    { $match: { $or: orConditions, direction: "incoming", type: "chat", readByAgent: false } },
    { $group: { _id: { $ifNull: ["$leadId", "$phone"] }, count: { $sum: 1 } } },
  ]);

  const counts = {};
  results.forEach((r) => {
    counts[String(r._id)] = r.count;
  });

  res.status(200).json(new ApiResponse(200, counts, "Unread counts fetched"));
});

export const markMessagesRead = asyncHandler(async (req, res) => {
  const { leadId } = req.params;
  if (!leadId) {
    throw new ApiError(400, "leadId is required");
  }

  // Group conversations ka phone field poora groupJid hota hai ("...@g.us"),
  // isliye digit-extraction + regex-suffix-match logic yahan lagu nahi hoti —
  // groupJid pe exact match karo, phone-regex wale normal leads ke liye niche wala path.
  const isGroup = /@g\.us$/.test(leadId);
  let matchQuery;

  if (isGroup) {
    matchQuery = {
      phone: leadId,
      isGroup: true,
      direction: "incoming",
      type: "chat",
      readByAgent: false,
    };
  } else {
    // Phone hi asli identity hai — leadId diya ho to bhi uska phone resolve karke
    // saare duplicate-tagged messages ek saath mark-read karo.
    const isObjectId = mongoose.Types.ObjectId.isValid(leadId);
    let last10;
    if (isObjectId) {
      const lead = await Lead.findById(leadId).lean();
      last10 = String(lead?.phone || "").replace(/\D/g, "").slice(-10);
    } else {
      last10 = leadId.replace(/\D/g, "").slice(-10);
    }

    matchQuery = {
      phone: { $regex: `${last10}$` },
      direction: "incoming",
      type: "chat",
      readByAgent: false,
    };
  }

  const result = await WhatsappMessage.updateMany(matchQuery, { $set: { readByAgent: true } });

  const io = req.app.get("io");
  if (io) {
    io.emit(
      "wa-unread-cleared",
      isGroup
        ? { phone: leadId }
        : mongoose.Types.ObjectId.isValid(leadId)
          ? { leadId }
          : { phone: leadId },
    );
  }

  res.status(200).json(new ApiResponse(200, { modifiedCount: result.modifiedCount }, "Messages marked as read"));
});

export const sendTypingStatus = asyncHandler(async (req, res) => {
  const { leadId, phone: rawPhone, groupJid, state } = req.body; // state: "composing" | "paused" | "recording"
  if (groupJid) {
    // Groups ke liye per-participant typing abhi support nahi hai — silently ignore
    return res.status(200).json(new ApiResponse(200, null, "Typing status skipped for group"));
  }
  if ((!leadId && !rawPhone) || !state) {
    throw new ApiError(400, "leadId or phone, and state are required");
  }

  let recipient = rawPhone ? normalizePhoneNumber(rawPhone) : null;
  if (leadId) {
    const lead = await Lead.findById(leadId).lean();
    if (!lead) {
      throw new ApiError(404, "Lead not found");
    }
    recipient = normalizePhoneNumber(lead.phone);
  }

  const userId = req.user?._id?.toString();
  const { isConnected: baileysConnected } = getBaileysStatus(userId);

  if (baileysConnected && recipient) {
    // Typing presence sirf Baileys (self-hosted) mein kaam karta hai, Cloud API isko expose nahi karta
    sendBaileysPresence(userId, recipient, state).catch(() => {});
  }

  res.status(200).json(new ApiResponse(200, null, "Typing status sent"));
});

export const subscribePresence = asyncHandler(async (req, res) => {
  const { leadId, phone: rawPhone, groupJid } = req.body;
  if (groupJid) {
    // Groups ke liye presence-subscribe applicable nahi hai — silently ignore
    return res.status(200).json(new ApiResponse(200, null, "Presence subscribe skipped for group"));
  }
  if (!leadId && !rawPhone) {
    throw new ApiError(400, "leadId or phone is required");
  }

  let recipient = rawPhone ? normalizePhoneNumber(rawPhone) : null;
  if (leadId) {
    const lead = await Lead.findById(leadId).lean();
    if (!lead) {
      throw new ApiError(404, "Lead not found");
    }
    recipient = normalizePhoneNumber(lead.phone);
  }

  const userId = req.user?._id?.toString();
  const { isConnected: baileysConnected } = getBaileysStatus(userId);

  if (baileysConnected && recipient) {
    subscribeBaileysPresence(userId, recipient).catch(() => {});
  }

  res.status(200).json(new ApiResponse(200, null, "Presence subscribed"));
});

export const getAgentsList = asyncHandler(async (req, res) => {
  const currentUser = req.user;
  const isPrivileged = currentUser?.role === "admin" || currentUser?.role === "manager";
  if (!isPrivileged) {
    throw new ApiError(403, "Not authorized to view agent list");
  }

  const agents = await User.find({
    organization: currentUser.organization,
    isActive: true,
  })
    .select("name email avatar color role")
    .lean();

  const result = agents.map((a) => {
    const status = getBaileysStatus(String(a._id));
    return {
      _id: a._id,
      name: a.name,
      email: a.email,
      avatar: a.avatar,
      color: a.color,
      role: a.role,
      isConnected: status.isConnected,
    };
  });

  res.status(200).json(new ApiResponse(200, result, "Agents fetched"));
});
