import {
  makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from "@whiskeysockets/baileys";
import { useMongoAuthState, deleteMongoAuthState } from "./baileysMongoAuth.js";
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

const NOISY_PATTERNS = [
  "Failed to decrypt message with any known session",
  "Session error:Error: Bad MAC",
  "Closing open session in favor of incoming prekey bundle",
  "Closing session:",
];

const shouldSuppress = (args) => {
  const text = args.map((a) => (typeof a === "string" ? a : "")).join(" ");
  return NOISY_PATTERNS.some((p) => text.includes(p));
};

const originalConsoleLog = console.log.bind(console);
const originalConsoleError = console.error.bind(console);
const originalConsoleWarn = console.warn.bind(console);
const originalConsoleInfo = console.info.bind(console);

console.log = (...args) => {
  if (shouldSuppress(args)) return;
  originalConsoleLog(...args);
};

console.error = (...args) => {
  if (shouldSuppress(args)) return;
  originalConsoleError(...args);
};

console.warn = (...args) => {
  if (shouldSuppress(args)) return;
  originalConsoleWarn(...args);
};

console.info = (...args) => {
  if (shouldSuppress(args)) return;
  originalConsoleInfo(...args);
};

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
      accountName: null, // WhatsApp account ka apna profile name (jab phone se seedha msg aaye)
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
    const { state, saveCreds } = await useMongoAuthState(userId);
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
        session.accountName = sock.user?.name || sock.user?.verifiedName || null;
        io.to(`user_${userId}`).emit("wa-connected");
        io.emit("wa-agent-status", { userId, isConnected: true });
        sock.sendPresenceUpdate("available").catch(() => {});
      }

      if (connection === "close") {
        session.isConnected = false;
        session.isInitializing = false;
        const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
        
        sock?.ev?.removeAllListeners();
        session.sock = null;
        io.emit("wa-agent-status", { userId, isConnected: false });

        if (reason !== DisconnectReason.loggedOut) {
          setTimeout(() => initBaileys(io, userId), 3000);
        } else {
          session.currentQR = null;
          session.isConnected = false;
          session.sock = null;
          deleteMongoAuthState(userId).catch(() => {});
          io.to(`user_${userId}`).emit("wa-logged-out");
          setTimeout(() => initBaileys(io, userId), 1000);
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
  if (type !== "notify") return;
  for (const msg of messages) {
    if (!msg.message) continue;

        const isFromMe = Boolean(msg.key.fromMe);

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
          session.lidPnCache.set(remoteJid, resolved);
        }

        if (!from) continue;

       const mediaMsg =
          msg.message.imageMessage ||
          msg.message.documentMessage ||
          msg.message.videoMessage ||
          msg.message.audioMessage ||
          null;
        const isIncomingVoiceNote = Boolean(msg.message.audioMessage);

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
          // Agar yeh CRM se bheja gaya tha, toh already save ho chuka hoga — duplicate mat banao
          if (alreadyExists) continue;
        }

        const last10 = from.slice(-10);
        const lead = await Lead.findOne({
          phone: { $regex: `${last10}$` },
        }).lean();

        if (!lead) continue;

        /* ── Agar yeh message kisi purane message ka reply hai, uska local _id nikalo ── */
        const contextInfo =
          msg.message.extendedTextMessage?.contextInfo ||
          msg.message.imageMessage?.contextInfo ||
          msg.message.videoMessage?.contextInfo ||
          msg.message.documentMessage?.contextInfo ||
          msg.message.audioMessage?.contextInfo ||
          null;
        const quotedStanzaId = contextInfo?.stanzaId || null;

        let replyTo = null;
        if (quotedStanzaId) {
          const quotedLocalMsg = await WhatsappMessage.findOne({
            metaMessageId: quotedStanzaId,
          }).lean();
          replyTo = quotedLocalMsg?._id || null;
        }

        // Defensive duplicate checks:
        // 1) If messageId exists, prefer DB lookup by metaMessageId
        // 2) Otherwise, detect near-duplicate by lead, phone, body within a short time window
        const DUP_WINDOW_MS = 10 * 1000; // 10 seconds
        if (messageId) {
          const exists = await WhatsappMessage.findOne({ metaMessageId: messageId }).lean();
          if (exists) {
            // already saved by another socket/path
            const populated = await WhatsappMessage.findById(exists._id)
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
            io.to(`lead_${lead._id}`).emit("wa-new-message", populated);
            if (!isFromMe) io.emit("wa-unread-new", { leadId: lead._id.toString() });
            continue;
          }
        } else {
          const recent = await WhatsappMessage.findOne({
            leadId: lead._id,
            phone: from,
            body: text,
            waUserId: userId,
            createdAt: { $gte: new Date(Date.now() - DUP_WINDOW_MS) },
          }).lean();
          if (recent) {
            const populated = await WhatsappMessage.findById(recent._id)
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
            io.to(`lead_${lead._id}`).emit("wa-new-message", populated);
            if (!isFromMe) io.emit("wa-unread-new", { leadId: lead._id.toString() });
            continue;
          }
        }

        // Atomic upsert — agar CRM controller ne already isi metaMessageId se record bana diya ho
        // (sentBy sahi wala), to $setOnInsert kuch nahi karega, sirf wahi doc mil jayega — duplicate nahi banega.
        const insertFields = {
          leadId: lead._id,
          organization: lead.organization,
          type: "chat",
          direction: isFromMe ? "outgoing" : "incoming",
          body: text,
          phone: from,
          status: isFromMe ? "sent" : "received",
          source: "baileys",
          waUserId: userId,
          mediaUrl,
          mediaName,
          isVoiceNote: isIncomingVoiceNote,
          waMessageRaw: { key: msg.key, message: msg.message },
          replyTo,
          // Phone se seedha bheja gaya message — CRM user ne nahi bheja, isliye sentBy null rahega
        };

        let saved;
        if (messageId) {
          insertFields.metaMessageId = messageId;
          saved = await WhatsappMessage.findOneAndUpdate(
            { metaMessageId: messageId },
            { $setOnInsert: insertFields },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          ).lean();
        } else {
          saved = await WhatsappMessage.create(insertFields);
        }
        const populatedSaved = saved._id
          ? await WhatsappMessage.findById(saved._id)
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
              .lean()
          : // already-lean doc returned from duplicate branch
            saved;

        io.to(`lead_${lead._id}`).emit("wa-new-message", populatedSaved);
        if (!isFromMe) {
          io.emit("wa-unread-new", { leadId: lead._id.toString() });
        }
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

    sock.ev.on("presence.update", ({ id, presences }) => {
       
      try {
        const presenceJid = id;
        const entries = Object.values(presences || {});
        const latest = entries[entries.length - 1];
        const lastKnown = latest?.lastKnownPresence;
        if (!lastKnown) return;

        let phoneNumber = presenceJid.split("@")[0];
        if (presenceJid.endsWith("@lid")) {
          const cached = session.lidPnCache.get(presenceJid);
          
          if (!cached) return;
          phoneNumber = cached;
        }

        const last10 = phoneNumber.slice(-10);
        Lead.findOne({ phone: { $regex: `${last10}$` } })
          .select("_id")
          .lean()
          .then((lead) => {
  
  if (!lead) return;
  io.emit("wa-typing", {
    leadId: lead._id.toString(),
    state: lastKnown,
  });
  
})
          .catch(() => {});
      } catch (e) {}
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
      logger.info?.(`[Call Event] Received ${calls.length} call event(s): ${JSON.stringify(calls)}`);
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

        if (!lead) {
          logger.warn?.(`[Call Event] No lead found for resolved number: ${resolvedNumber}`);
          continue;
        }

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

export const sendBaileysMessage = async (userId, phone, text, quotedRaw = null) => {
  const session = sessions.get(userId);
  if (!session?.sock || !session.isConnected) {
    throw new Error("Baileys not connected");
  }
  const jid = `${phone}@s.whatsapp.net`;
  await session.sock.presenceSubscribe(jid).catch(() => {});
  const options = quotedRaw ? { quoted: quotedRaw } : undefined;
  const result = await session.sock.sendMessage(jid, { text }, options);
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
    await deleteMongoAuthState(userId).catch(() => {});
    if (session) {
      session.sock = null;
      session.isConnected = false;
      session.currentQR = null;
    }
    return;
  }

  try {
    await session.sock.logout();
  } catch (error) {
    await deleteMongoAuthState(userId).catch(() => {});
    throw error;
  }
};

export const sendBaileysMedia = async (userId, phone, filePath, fileName, mimetype, caption = "", quotedRaw = null) => {
  const session = sessions.get(userId);
  if (!session?.sock || !session.isConnected) {
    throw new Error("Baileys not connected");
  }
  const jid = `${phone}@s.whatsapp.net`;
  await session.sock.presenceSubscribe(jid).catch(() => {});

  const isImage = mimetype?.startsWith("image/");
  const isAudio = mimetype?.startsWith("audio/");

  let content;
  if (isAudio) {
    // Voice note (ptt) — WhatsApp voice notes caption support nahi karte
    content = {
      audio: { url: filePath },
      mimetype: "audio/ogg; codecs=opus",
      ptt: true,
    };
  } else if (isImage) {
    content = { image: { url: filePath }, caption };
  } else {
    content = { document: { url: filePath }, fileName, mimetype, caption };
  }

  const options = quotedRaw ? { quoted: quotedRaw } : undefined;

  const result = await session.sock.sendMessage(jid, content, options);
  return result;
}

export const sendBaileysPresence = async (userId, phone, state) => {
  // state: "composing" | "recording" | "paused" | "available"
  const session = sessions.get(userId);
  if (!session?.sock || !session.isConnected) return;
  const jid = `${phone}@s.whatsapp.net`;
  try {
    await session.sock.presenceSubscribe(jid);
    await session.sock.sendPresenceUpdate(state, jid);
  } catch (e) {
    // presence errors se chat break nahi hona chahiye
  }
};

export const subscribeBaileysPresence = async (userId, phone) => {
  const session = sessions.get(userId);
  if (!session?.sock || !session.isConnected) {
    
    return;
  }
  const jid = `${phone}@s.whatsapp.net`;
  try {
    await session.sock.presenceSubscribe(jid);
    
  } catch (e) {
    
  }
};
export const editBaileysMessage = async (userId, phone, newText, messageKey) => {
  const session = sessions.get(userId);
  if (!session?.sock || !session.isConnected) {
    throw new Error("Baileys not connected");
  }
  const jid = `${phone}@s.whatsapp.net`;
  const result = await session.sock.sendMessage(jid, {
    text: newText,
    edit: messageKey,
  });
  return result;
};
