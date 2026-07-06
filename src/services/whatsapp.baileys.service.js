import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from "@whiskeysockets/baileys";
import fs from "fs";
import { Boom } from "@hapi/boom";
import WhatsappMessage from "../models/WhatsappMessage.model.js";
import Lead from "../models/Lead.model.js";
import logger from "../utils/logger.js";
import path from "path";
const baileysLogger = {
  level: "silent",
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => baileysLogger,
};

const AUTH_FOLDER_BASE = "baileys_auth";

/* ── Status ko sirf upgrade hone do, downgrade (race condition) mat hone do ── */
const STATUS_RANK = { sent: 1, delivered: 2, read: 3 };

const updateMessageStatusSafely = async (messageId, newStatus, io) => {
  const existing = await WhatsappMessage.findOne({ metaMessageId: messageId }).lean();
  if (!existing) return;

  const currentRank = STATUS_RANK[existing.status] || 0;
  const newRank = STATUS_RANK[newStatus] || 0;

  if (newRank < currentRank) {
    // purana/late event hai, ignore karo
    return;
  }

  const updated = await WhatsappMessage.findOneAndUpdate(
    { metaMessageId: messageId },
    { $set: { status: newStatus } },
    { new: true },
  ).lean();

  if (updated) {
    io.to(`lead_${updated.leadId}`).emit("wa-message-status", {
      _id: updated._id.toString(),
      status: newStatus,
    });
  }
};

/* ── Har user ke liye alag session store ── */
const sessions = new Map(); // Map<userId, { sock, currentQR, isConnected, isInitializing, activeCalls }>

const getSession = (userId) => {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      sock: null,
      currentQR: null,
      isConnected: false,
      isInitializing: false,
      activeCalls: new Map(),
      lidPnCache: new Map(), // Map<lidJid, phoneNumber> — logger se populate hoga
    });
  }
  return sessions.get(userId);
};


const makeSessionLogger = (session) => {
  const captureFromObj = (obj) => {
    try {
      const attrs = obj?.msgAttrs;
      if (!attrs) return;
      if (attrs.from?.endsWith("@lid") && attrs.sender_pn) {
        session.lidPnCache.set(attrs.from, attrs.sender_pn.split("@")[0].split(":")[0]);
      }
      if (attrs.recipient?.endsWith("@lid") && attrs.peer_recipient_pn) {
        session.lidPnCache.set(attrs.recipient, attrs.peer_recipient_pn.split("@")[0].split(":")[0]);
      }
    } catch (e) {}
  };

  const noop = () => {};
  const logObj = {
    level: "info",
    trace: noop,
    debug: noop,
    info: (obj) => captureFromObj(obj),
    warn: (obj) => captureFromObj(obj),
    error: noop,
    fatal: noop,
    child: () => logObj,
  };
  return logObj;
};

/**
 * @lid jids ka real phone number turant resolve nahi hota kabhi kabhi.
 * Isliye ek retry loop lagate hain (max 5 tries, 1.5s gap) bajaye
 * pehli try mein fail hote hi message drop karne ke.
 */
const resolveLidToPhone = async (sock, lidJid, session, maxAttempts = 5, delayMs = 1500, msgKey = null) => {
  const lidUser = lidJid.split("@")[0];

  // ── Step 0: pehle apna khud ka cache check karo (logger se capture hua sender_pn) ──
  if (session?.lidPnCache?.has(lidJid)) {
    return session.lidPnCache.get(lidJid);
  }

  // ── Step 1: msg.key mein hi direct PN jid mil sakta hai (fastest, no lookup needed) ──
  const altJid = msgKey?.remoteJidAlt || msgKey?.participantAlt || msgKey?.senderAlt;
  if (altJid && altJid.includes("@s.whatsapp.net")) {
    logger.info?.(`[LID] Resolved via key.remoteJidAlt directly: ${altJid}`);
    return altJid.split("@")[0].split(":")[0];
  }

  // DEBUG: ek hi baar check karo ki lidMapping object mein kya available hai
  if (!resolveLidToPhone._debugged) {
    resolveLidToPhone._debugged = true;
    try {
      const lm = sock.signalRepository?.lidMapping;
      logger.info?.(`[LID DEBUG] lidMapping keys: ${lm ? Object.getOwnPropertyNames(Object.getPrototypeOf(lm)).join(", ") : "undefined"}`);
      logger.info?.(`[LID DEBUG] msgKey received: ${JSON.stringify(msgKey)}`);
    } catch (e) {
      logger.warn?.(`[LID DEBUG] could not inspect lidMapping: ${e.message}`);
    }
  }

  // ── Step 2: signalRepository se retry ke sath try karo ──
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Har retry ke pehle cache dobara check karo — retry receipt beech mein aa sakta hai
    if (session?.lidPnCache?.has(lidJid)) {
      return session.lidPnCache.get(lidJid);
    }
    try {
      const lm = sock.signalRepository?.lidMapping;
      const pn =
        (await lm?.getPNForLID?.(lidUser)) ||
        (await lm?.getPNForLID?.(lidJid));

      if (pn) {
        return pn.split("@")[0].split(":")[0];
      }
    } catch (e) {
      // signalRepository.lidMapping is undefined in this baileys version, ignore
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // Aakhri koshish: cache ek baar aur check karo
  return session?.lidPnCache?.get(lidJid) || null;
};

export const initBaileys = async (io, userId) => {
  if (!userId) throw new Error("userId is required to init a WhatsApp session");

  const session = getSession(userId);
  if (session.isInitializing) return;
  session.isInitializing = true;

  try {
    const authFolder = `${AUTH_FOLDER_BASE}_${userId}`;
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
      },
      logger: makeSessionLogger(session),
      version,
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });
    session.sock = sock;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        session.currentQR = qr;
        session.isConnected = false;
        io.to(`user_${userId}`).emit("wa-qr", qr);
      }

      if (connection === "open") {
        session.isConnected = true;
        session.currentQR = null;
        io.to(`user_${userId}`).emit("wa-connected");
      }

      if (connection === "close") {
        session.isConnected = false;
        session.isInitializing = false;
        const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
        sock?.ev?.removeAllListeners();
        session.sock = null;

        if (reason !== DisconnectReason.loggedOut) {
          setTimeout(() => initBaileys(io, userId), 3000);
        } else {
          session.currentQR = null;
          try {
            fs.rmSync(authFolder, { recursive: true, force: true });
          } catch (fsErr) {}
          io.to(`user_${userId}`).emit("wa-logged-out");
          setTimeout(() => initBaileys(io, userId), 1000);
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
  if (type !== "notify") return;
  for (const msg of messages) {
    if (!msg.message || msg.key.fromMe) continue;

        const remoteJid = msg.key.remoteJid || "";
        if (
          remoteJid.endsWith("@g.us") ||
          remoteJid === "status@broadcast" ||
          remoteJid.endsWith("@newsletter")
        ) {
          continue;
        }

        let from = remoteJid.split("@")[0];

        if (remoteJid.endsWith("@lid")) {
          const resolved = await resolveLidToPhone(sock, remoteJid, session, 5, 1500, msg.key);
          if (!resolved) {
            logger.warn?.(`Could not resolve LID ${remoteJid} to phone number after retries, skipping message`);
            continue;
          }
          from = resolved;
        }

        if (!from) continue;

        const mediaMsg =
          msg.message.imageMessage ||
          msg.message.documentMessage ||
          msg.message.videoMessage ||
          msg.message.audioMessage ||
          null;

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          mediaMsg?.caption ||
          "";

        let mediaUrl = "";
        let mediaName = "";

        if (mediaMsg) {
          try {
            const { downloadMediaMessage } = await import("@whiskeysockets/baileys");
            const buffer = await downloadMediaMessage(msg, "buffer", {});
            const ext = mediaMsg.mimetype?.split("/")[1]?.split(";")[0] || "bin";
            mediaName =
              msg.message.documentMessage?.fileName || `whatsapp_${Date.now()}.${ext}`;
            const savedFileName = `${Date.now()}_${Math.round(Math.random() * 1e9)}.${ext}`;
            const savePath = path.join(process.cwd(), "uploads", "whatsapp", savedFileName);
            fs.writeFileSync(savePath, buffer);
            mediaUrl = `/uploads/whatsapp/${savedFileName}`;
          } catch (mediaErr) {
            logger.warn?.(`Failed to download incoming media: ${mediaErr.message}`);
          }
        }

        if (!text && !mediaUrl) continue;

        const messageId = msg.key.id || "";
        if (messageId) {
          const alreadyExists = await WhatsappMessage.findOne({
            metaMessageId: messageId,
          }).lean();
          if (alreadyExists) continue;
        }

        const last10 = from.slice(-10);
        const lead = await Lead.findOne({
          phone: { $regex: `${last10}$` },
        }).lean();

        if (!lead) continue;

        const saved = await WhatsappMessage.create({
          leadId: lead._id,
          organization: lead.organization,
          type: "chat",
          direction: "incoming",
          body: text,
          phone: from,
          status: "received",
          source: "baileys",
          metaMessageId: messageId,
          waUserId: userId,
          mediaUrl,
          mediaName,
        });
        io.to(`lead_${lead._id}`).emit("wa-new-message", saved);
      }
    });

    sock.ev.on("messages.update", async (updates) => {
  for (const update of updates) {
    const messageId = update.key?.id;
    const statusCode = update.update?.status;
    
    if (!messageId || statusCode === undefined) continue;

        let mappedStatus;
        if (statusCode === 3) mappedStatus = "delivered";
        else if (statusCode === 4 || statusCode === 5) mappedStatus = "read";
        else continue;

        await updateMessageStatusSafely(messageId, mappedStatus, io);
      }
    });

    /* ── Read receipts jab chat already open ho, alag event se aate hain ── */
    sock.ev.on("message-receipt.update", async (updates) => {
      for (const { key, receipt } of updates) {
        const messageId = key?.id;
        const receiptType = receipt?.type; // "read", "read-self", "played", etc.
        if (!messageId || !receiptType) continue;

        let mappedStatus;
        if (receiptType === "read" || receiptType === "read-self" || receiptType === "played") {
          mappedStatus = "read";
        } else {
          continue;
        }

        await updateMessageStatusSafely(messageId, mappedStatus, io);
      }
    });

    sock.ev.on("call", async (calls) => {
      for (const call of calls) {
        const { id: callId, from, status, isVideo, isGroup } = call;
        if (isGroup) continue;

        if (status === "offer") {
          session.activeCalls.set(callId, { accepted: false, isVideo, from });
          continue;
        }
        if (status === "accept") {
          const entry = session.activeCalls.get(callId);
          if (entry) entry.accepted = true;
          continue;
        }
        if (status === "ringing") continue;
        if (status !== "terminate" && status !== "reject" && status !== "timeout") {
          continue;
        }

        const entry = session.activeCalls.get(callId) || { accepted: false, isVideo, from };
        session.activeCalls.delete(callId);

        const callType = entry.accepted
          ? (entry.isVideo ? "video" : "incoming")
          : "missed";

        const alreadyLogged = await WhatsappMessage.findOne({
          metaMessageId: callId,
        }).lean();
        if (alreadyLogged) continue;

        let resolvedNumber = null;
        const rawFrom = entry.from || from;

        if (rawFrom.endsWith("@lid")) {
          resolvedNumber = await resolveLidToPhone(sock, rawFrom, session);
        } else {
          resolvedNumber = rawFrom.split("@")[0].split(":")[0];
        }

        if (!resolvedNumber) continue;

        const last10 = resolvedNumber.slice(-10);
        const lead = await Lead.findOne({
          phone: { $regex: `${last10}$` },
        }).lean();

        if (!lead) continue;

        const saved = await WhatsappMessage.create({
          leadId: lead._id,
          organization: lead.organization,
          type: "call",
          direction: "incoming",
          callType,
          phone: resolvedNumber,
          status: "received",
          source: "baileys",
          metaMessageId: callId,
          waUserId: userId,
        });

        io.to(`lead_${lead._id}`).emit("wa-new-message", saved);
      }
    });

    session.isInitializing = false;
  } catch (err) {
    session.isInitializing = false;
    
  }
};

export const sendBaileysMessage = async (userId, phone, text) => {
  const session = sessions.get(userId);
  if (!session?.sock || !session.isConnected) {
    throw new Error("Baileys not connected");
  }
  const jid = `${phone}@s.whatsapp.net`;
  const result = await session.sock.sendMessage(jid, { text });
  return result;
};

export const getBaileysStatus = (userId) => {
  const session = sessions.get(userId);
  return {
    isConnected: session?.isConnected || false,
    currentQR: session?.currentQR || null,
  };
};

export const logoutBaileysSession = async (userId) => {
  const session = sessions.get(userId);
  if (!session?.sock) {
    throw new Error("WhatsApp session is not active");
  }
  await session.sock.logout();
};
export const sendBaileysMedia = async (userId, phone, filePath, fileName, mimetype, caption = "") => {
  const session = sessions.get(userId);
  if (!session?.sock || !session.isConnected) {
    throw new Error("Baileys not connected");
  }
  const jid = `${phone}@s.whatsapp.net`;
  const isImage = mimetype?.startsWith("image/");
  const content = isImage
    ? { image: { url: filePath }, caption }
    : { document: { url: filePath }, fileName, mimetype, caption };

  const result = await session.sock.sendMessage(jid, content);
  return result;
};