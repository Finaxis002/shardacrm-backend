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
import WhatsappContact from "../models/WhatsappContact.model.js";
import User from "../models/User.model.js";

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

const installBaileysNoiseFilter = () => {
  if (globalThis.__baileysNoiseFilterInstalled) return;

  const originalConsoleError = console.error.bind(console);
  const originalConsoleWarn = console.warn.bind(console);
  const originalConsoleInfo = console.info.bind(console);

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

  globalThis.__baileysNoiseFilterInstalled = true;
};

installBaileysNoiseFilter();

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
  const last10 = String(updated.phone || "").replace(/\D/g, "").slice(-10);
  const roomKey = updated.isGroup
    ? `group_${updated.phone}`
    : updated.leadId
      ? `lead_${updated.leadId}`
      : `wa_${last10}`;

  io.to(roomKey).emit("wa-message-status", {
    _id: updated._id.toString(),
    status: newStatus,
  });
} 
};

/* ── Har user ke liye alag session store ── */
const sessions = new Map(); // Map<userId, { sock, currentQR, isConnected, isInitializing, activeCalls }>

const pendingLidMessages = [];
const MAX_LID_PENDING_AGE_MS = 6 * 60 * 60 * 1000; // 6 ghante ke baad hi finally drop karo

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
      profilePicCache: new Map(), // Map<"orgId:phone", { fetchedAt }> — DP baar baar fetch na ho isliye
      organization: null, // Lead na mile to isi WA account owner ki org use hogi
      groupMetaCache: new Map(), // Map<groupJid, { subject, fetchedAt }> — group naam baar baar fetch na ho isliye
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
const resolveLidToPhone = async (sock, lidJid, session, maxAttempts = 2, delayMs = 500, msgKey = null) => {
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

/**
 * Jab kisi phone number ka CRM me Lead nahi milta, tab bhi message/contact
 * save karna hai — uske liye us WhatsApp session ko chalane wale CRM user
 * ki khud ki organization use karte hain (ek baar fetch karke session pe cache).
 */
const getSessionOrganization = async (session, userId) => {
  if (session.organization) return session.organization;
  const user = await User.findById(userId).select("organization").lean();
  session.organization = user?.organization || null;
  return session.organization;
};

/**
 * Naam + profile picture ko WhatsappContact collection mein save karta hai,
 * sirf tab jab us phone number ka koi Lead CRM mein already exist karta ho
 * (warna organization pata nahi chalega, aur bekaar contact store karne ka fayda nahi).
 */
const upsertWhatsappContact = async (io, sock, session, userId, jid, waName) => {
  try {
    if (!jid || jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.endsWith("@newsletter")) {
      return;
    }

    let phone = jid.split("@")[0];
    if (jid.endsWith("@lid")) {
      const resolved = await resolveLidToPhone(sock, jid, session);
      if (!resolved) return;
      phone = resolved;
    }

    const last10 = phone.slice(-10);

    // Lead mile to uski org use karo, warna WA account owner (userId) ki org
    const lead = await Lead.findOne({ phone: { $regex: `${last10}$` } })
      .select("organization")
      .sort({ createdAt: -1 }) // duplicate Leads (same phone) ho to hamesha sabse recent wali uthao
      .lean();
    const organization = lead?.organization || (await getSessionOrganization(session, userId));
    if (!organization) return;

    const updateFields = {};
    if (waName) {
      // Agar contact ka naam already saved-name se set ho chuka hai, to
      // baad me aane wala pushName (jo sirf username hota hai) usse
      // overwrite na kare — sirf tab update karo jab koi naam pehle se na ho.
      const existingContact = await WhatsappContact.findOne({ organization, phone: last10 }).select("waName waNameIsSaved").lean();
      if (!existingContact?.waNameIsSaved) {
        updateFields.waName = waName;
      }
    }

    const cacheKey = `${organization}:${last10}`;
    const cached = session.profilePicCache?.get(cacheKey);
    const ONE_DAY = 24 * 60 * 60 * 1000;
    if (!cached || Date.now() - cached.fetchedAt > ONE_DAY) {
      try {
        const picUrl = await sock.profilePictureUrl(jid, "image");
        if (picUrl) {
          updateFields.profilePicUrl = picUrl;
          updateFields.profilePicUpdatedAt = new Date();
        }
      } catch (e) {
        // DP set nahi hai ya privacy settings ki wajah se block hai — ignore karo
      }
      session.profilePicCache?.set(cacheKey, { fetchedAt: Date.now() });
    }

    if (Object.keys(updateFields).length === 0) return;

    const updatedContact = await WhatsappContact.findOneAndUpdate(
      { organization, phone: last10 },
      { $set: { ...updateFields, lastSyncedAt: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    io.emit("wa-contact-updated", {
      phone: last10,
      waName: updatedContact.waName,
      profilePicUrl: updatedContact.profilePicUrl,
    });
  } catch (err) {
    logger.warn?.(`[upsertWhatsappContact] error for ${jid}: ${err.message}`);
  }
};


const parseBaileysTimestamp = (ts) => {
  const seconds = Number(ts?.low ?? ts ?? 0);
  if (!seconds) return new Date();
  return new Date(seconds * 1000);
};

/**
 * Group ka subject/naam fetch karta hai, ek din tak cache karke — har message
 * pe baar baar WhatsApp se group metadata na maangna pade isliye.
 */
const getGroupSubject = async (sock, session, groupJid) => {
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const cached = session.groupMetaCache?.get(groupJid);
  if (cached && Date.now() - cached.fetchedAt < ONE_DAY) {
    return cached.subject;
  }
  try {
    const meta = await sock.groupMetadata(groupJid);
    const subject = meta?.subject || "";
    session.groupMetaCache?.set(groupJid, { subject, fetchedAt: Date.now() });
    return subject;
  } catch (e) {
    // Fetch fail ho to purana cached naam hi use karo, agar hai to
    return cached?.subject || "";
  }
};
/**
 * Ek hi incoming/self message ko process karne ka shared logic —
 * ye "messages.upsert" (live) aur "messaging-history.set" (catch-up/reconnect
 * ke baad backfill) dono jagah se use hoga, taaki koi bhi message miss na ho
 * chahe woh CRM se bheja gaya ho ya phone se seedha.
 */
const processIncomingMessage = async (sock, session, io, userId, msg, pendingSince = null) => {
  const msgIdShort = msg?.key?.id || "no-id";
  if (!msg.message) {
    logger.info(`[SYNC SKIP] ${msgIdShort} — empty message payload`);
    return;
  }

const isFromMe = Boolean(msg.key.fromMe);

  const remoteJid = msg.key.remoteJid || "";
  if (remoteJid === "status@broadcast" || remoteJid.endsWith("@newsletter")) {
    logger.info(`[SYNC SKIP] ${msgIdShort} — broadcast/newsletter (${remoteJid})`);
    return;
  }

  const isGroup = remoteJid.endsWith("@g.us");
  let from = remoteJid.split("@")[0]; // group ke liye ye groupJid ka numeric part hoga
  let senderPhone = null;
  let senderName = null;
  let groupSubject = "";

  if (isGroup) {
    // Group message — asli bhejne wala 'participant' field mein hota hai, remoteJid to group ka hai
    const participantJid = msg.key.participant || "";
    let resolvedSender = participantJid.split("@")[0] || null;
    if (participantJid.endsWith("@lid")) {
      const resolved = await resolveLidToPhone(sock, participantJid, session, 5, 1500, msg.key);
      if (resolved) resolvedSender = resolved;
    }
    senderPhone = resolvedSender;
    senderName = msg.pushName || null;
    groupSubject = await getGroupSubject(sock, session, remoteJid);
  } else if (remoteJid.endsWith("@lid")) {
    const resolved = await resolveLidToPhone(sock, remoteJid, session, 5, 1500, msg.key);
    if (!resolved) {
      // Turant pseudo-thread banane ke bajaye retry queue mein daalo
      // (30s interval, 6h tak) — false-duplicate "lid_..." threads
      // banna band ho jayega.
      const firstSeenAt = pendingSince ?? Date.now();
      if (Date.now() - firstSeenAt < MAX_LID_PENDING_AGE_MS) {
        pendingLidMessages.push({ msg, io, userId, firstSeenAt });
        logger.warn?.(`[LID] Could not resolve ${remoteJid}, queued for retry (age=${Date.now() - firstSeenAt}ms)`);
        return;
      }
      // 6 ghante ke baad bhi resolve nahi hua — tabhi pseudo-identity use karo
      const lidPseudoId = remoteJid.split("@")[0];
      logger.warn?.(`[LID] Could not resolve ${remoteJid} after 6h of retries — saving under pseudo-identity lid_${lidPseudoId}`);
      from = `lid_${lidPseudoId}`;
    } else {
      from = resolved;
      session.lidPnCache.set(remoteJid, resolved);
    }
  }

  if (!from) {
    logger.info(`[SYNC SKIP] ${msgIdShort} — no identifier resolved`);
    return;
  }

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

  if (!text && !mediaUrl) {
    logger.info(`[SYNC SKIP] ${msgIdShort} — no text or media content`);
    return;
  }

  const messageId = msg.key.id || "";
  if (messageId) {
    const alreadyExists = await WhatsappMessage.findOne({
      metaMessageId: messageId,
    }).lean();
    if (alreadyExists) {
      logger.info(`[SYNC SKIP] ${msgIdShort} — already exists in DB (duplicate)`);
      return;
    }
  }

  const isUnresolvedLid = from.startsWith("lid_");
  const last10 = from.slice(-10);

  // ── Groups ka koi Lead nahi hota, aur unresolved-LID pseudo-ID bhi kisi
  //    real phone se match nahi karwana — warna galat Lead se link ho sakta hai ──
  const lead = isGroup || isUnresolvedLid
    ? null
    : await Lead.findOne({
        phone: { $regex: `${last10}$` },
      })
        .sort({ createdAt: -1 })
        .lean();

  const organization = lead?.organization || (await getSessionOrganization(session, userId));
  if (!organization) {
    logger.info(`[SYNC SKIP] ${msgIdShort} — no organization resolved for ${from} / userId ${userId}`);
    logger.warn?.(`[processIncomingMessage] No organization resolved for userId ${userId}, dropping message`);
    return;
  }

  const roomKey = isGroup ? `group_${from}` : lead ? `lead_${lead._id}` : `wa_${last10}`;
  const emitLeadId = lead ? lead._id.toString() : null;

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

  const populateChain = (query) =>
    query
      .populate("sentBy", "name email")
      .populate("waUserId", "name email")
      .populate({
        path: "replyTo",
        select: "body direction type callType mediaName createdAt sentBy waUserId",
        populate: [
          { path: "sentBy", select: "name email" },
          { path: "waUserId", select: "name email" },
        ],
      });

  const DUP_WINDOW_MS = 10 * 1000;
  if (messageId) {
    const exists = await WhatsappMessage.findOne({ metaMessageId: messageId }).lean();
    if (exists) {
      const populated = await populateChain(WhatsappMessage.findById(exists._id)).lean();
      io.to(roomKey).emit("wa-new-message", populated);
      if (!isFromMe) io.emit("wa-unread-new", { leadId: emitLeadId, phone: last10 });
      return;
    }
  } else {
    const recent = await WhatsappMessage.findOne({
      phone: from,
      body: text,
      waUserId: userId,
      createdAt: { $gte: new Date(Date.now() - DUP_WINDOW_MS) },
    }).lean();
    if (recent) {
      const populated = await populateChain(WhatsappMessage.findById(recent._id)).lean();
      io.to(roomKey).emit("wa-new-message", populated);
      if (!isFromMe) io.emit("wa-unread-new", { leadId: emitLeadId, phone: last10 });
      return;
    }
  }

  const actualMessageTime = parseBaileysTimestamp(msg.messageTimestamp);
  

  const insertFields = {
    leadId: lead?._id || null,
    organization,
    type: "chat",
    direction: isFromMe ? "outgoing" : "incoming",
    body: text,
    // Group ke liye pura groupJid (jaise "1203...@g.us") store karo — ye
    // globally unique hai aur "@g.us" ki wajah se kabhi bhi individual
    // phone-number regex queries se accidentally match nahi hoga.
    phone: isGroup ? remoteJid : from,
    status: isFromMe ? "sent" : "received",
    source: "baileys",
    waUserId: userId,
    mediaUrl,
    mediaName,
    isVoiceNote: isIncomingVoiceNote,
    waMessageRaw: { key: msg.key, message: msg.message },
    replyTo,
    createdAt: actualMessageTime, // ← asli WhatsApp timestamp, insert-time nahi
    isGroup,
    groupJid: isGroup ? remoteJid : null,
    groupSubject: isGroup ? groupSubject : "",
    senderPhone: isGroup ? senderPhone : null,
    senderName: isGroup ? senderName : null,
  };

  let saved;
  if (messageId) {
    insertFields.metaMessageId = messageId;
    saved = await WhatsappMessage.findOneAndUpdate(
      { metaMessageId: messageId },
      { $setOnInsert: insertFields },
      { upsert: true, new: true, setDefaultsOnInsert: true, timestamps: false },
    ).lean();
  } else {
    saved = await WhatsappMessage.create(insertFields);
  }
  const populatedSaved = saved._id
    ? await populateChain(WhatsappMessage.findById(saved._id)).lean()
    : saved;

  logger.info(`[SYNC OK] ${msgIdShort} — saved & emitted (phone=${last10}, lead=${emitLeadId || "none"})`);
  io.to(roomKey).emit("wa-new-message", populatedSaved);
  if (!isFromMe) {
    io.emit("wa-unread-new", { leadId: emitLeadId, phone: last10 });
  }
};

/**
 * Har 30 sec me pending LID messages ko dobara resolve karne ki koshish
 * karta hai. Agar resolve ho jaye to processIncomingMessage khud message
 * save/emit kar dega. Agar socket abhi bhi connected nahi hai ya resolve
 * nahi hua, to entry wapas queue me chali jaati hai agli baar ke liye —
 * 6 ghante tak, uske baad permanently drop.
 */
const retryPendingLidMessages = async () => {
  if (pendingLidMessages.length === 0) return;
  const batch = pendingLidMessages.splice(0, pendingLidMessages.length);
  const now = Date.now();
  logger.info?.(`[LID Retry] Retrying ${batch.length} pending message(s)`);

  for (const entry of batch) {
    if (now - entry.firstSeenAt > MAX_LID_PENDING_AGE_MS) {
      logger.warn?.(`[LID Retry] Dropping message ${entry.msg?.key?.id || "unknown"} after 6h — LID never resolved`);
      continue;
    }
    const currentSession = sessions.get(entry.userId);
    const currentSock = currentSession?.sock;
    if (!currentSock || !currentSession?.isConnected) {
      pendingLidMessages.push(entry); // socket abhi ready nahi, agli baar try karo
      continue;
    }
    try {
      await processIncomingMessage(currentSock, currentSession, entry.io, entry.userId, entry.msg, entry.firstSeenAt);
    } catch (err) {
      logger.error?.(`[LID Retry] error reprocessing message: ${err.message}`);
      pendingLidMessages.push(entry); // wapas try karne ke liye rakh do
    }
  }
};

setInterval(retryPendingLidMessages, 30000);

export const initBaileys = async (io, userId) => {
  if (!userId) throw new Error("userId is required to init a WhatsApp session");

  const session = getSession(userId);
  if (session.isInitializing) {
    logger.warn?.(`[Baileys] initBaileys called for ${userId} but already initializing, skipping`);
    return;
  }
  // Agar socket already bana hua hai aur connect hone ka wait kar raha hai
  // (QR scan ka intezaar), to naya socket mat banao — warna purana
  // pairing session beech mein hi tootkar QR kabhi stabilize nahi hota.
  if (session.sock && !session.isConnected) {
    logger.warn?.(`[Baileys] initBaileys called for ${userId} but a socket is already pending connection, skipping`);
    return;
  }
  session.isInitializing = true;

  // Safety net — agar kisi wajah se init 30 sec me complete/fail na ho
  // (network hang, Mongo query atak jaaye), to flag ko forcefully reset karo
  // taaki agla connect attempt permanently blocked na rahe.
  const initTimeoutGuard = setTimeout(() => {
    if (session.isInitializing) {
      logger.error?.(`[Baileys] Init timed out after 30s for user ${userId}, resetting isInitializing flag`);
      session.isInitializing = false;
      io.to(`user_${userId}`).emit("wa-connect-error", {
        message: "WhatsApp connection timed out. Please try again.",
      });
    }
  }, 30000);

  try {
    logger.info?.(`[Baileys] Starting init for user ${userId}`);
let { state, saveCreds } = await useMongoAuthState(userId);
if (!state?.creds?.noiseKey) {
  logger.warn?.(`[Baileys] Corrupt/incomplete creds detected for user ${userId}, wiping and starting fresh`);
  await deleteMongoAuthState(userId).catch(() => {});
  ({ state, saveCreds } = await useMongoAuthState(userId));
}

logger.info?.(`[Baileys] Auth state loaded for user ${userId}`);
const { version } = await fetchLatestBaileysVersion();
logger.info?.(`[Baileys] Baileys version fetched for user ${userId}: ${version}`);

// Sirf pehli baar (fresh QR scan) full history chahiye — baad ke reconnects
// (session already registered) pe poori history dobara mangwana bhaari
// aur unnecessary hai, sirf incremental messages hi chahiye.
const isFreshPairing = !state?.creds?.registered;
logger.info?.(`[Baileys] isFreshPairing=${isFreshPairing} for user ${userId}`);

const sock = makeWASocket({
  auth: {
    creds: state.creds,
    keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
  },
  logger: makeSessionLogger(session),
  version,
  printQRInTerminal: false,
  syncFullHistory: isFreshPairing, // naye QR scan pe hi poori history, reconnect pe nahi
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
          // store account jid/phone for quick access
          try {
            const accountJid = sock.user?.id || sock.user?.jid || null;
            session.accountJid = accountJid;
            if (accountJid) {
              const digits = String(accountJid).replace(/\D/g, "");
              session.accountPhone = digits.slice(-10);
            }
          } catch (e) {}
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
        // NOTE: "done" yahan se emit nahi karte — connection close ka matlab
        // history-sync complete hona nahi hai. Agar sync abhi chal hi raha
        // tha, reconnect ke baad "wa-connected" + naya messaging-history.set
        // cycle apne aap sahi "syncing"/"done" bhej dega.

        if (reason !== DisconnectReason.loggedOut) {
          setTimeout(() => initBaileys(io, userId), 3000);
        } else {
          session.currentQR = null;
          session.isConnected = false;
          session.isInitializing = false;
          session.sock = null;
          session.accountJid = null;
          session.accountPhone = null;
          session.accountName = null;
          deleteMongoAuthState(userId).catch(() => {});
          io.to(`user_${userId}`).emit("wa-logged-out");
          // Do not re-init after an intentional logout.
        }
      }
    });

sock.ev.on("messages.upsert", async ({ messages, type }) => {
  if (type !== "notify") return;
  await Promise.allSettled(
    messages.map((msg) =>
      processIncomingMessage(sock, session, io, userId, msg).catch((err) =>
        logger.error?.(`[messages.upsert] item error: ${err.message}`),
      ),
    ),
  );
});

    /* ── Reconnect ke baad WhatsApp jo missed/backfilled messages bhejta hai,
       unhe bhi isi tarah process karo — warna phone se seedha bheja gaya
       message CRM mein kabhi nahi aayega agar backend connect nahi tha. ── */
sock.ev.on("messaging-history.set", async ({ contacts, messages, isLatest }) => {
      // ── Progress tracking: is connect-cycle ke liye ek hi baar init karo ──
      // newestTs = poore session ka sabse naya message (denominator ka top)
      // oldestTs = ab tak jitna peeche pahunch chuke hain (denominator ka bottom)
      if (!session.historySyncMeta) {
        session.historySyncMeta = { newestTs: null, oldestTs: null, cutoffTs: null };
      }

      if (Array.isArray(messages) && messages.length > 0) {
        const timestamps = messages
          .map((m) => Number(m.messageTimestamp?.low ?? m.messageTimestamp ?? 0))
          .filter(Boolean);
        if (timestamps.length > 0) {
          const chunkMax = Math.max(...timestamps);
          const chunkMin = Math.min(...timestamps);
          if (session.historySyncMeta.newestTs === null) {
            session.historySyncMeta.newestTs = chunkMax;
          } else {
            session.historySyncMeta.newestTs = Math.max(session.historySyncMeta.newestTs, chunkMax);
          }
          session.historySyncMeta.oldestTs =
            session.historySyncMeta.oldestTs === null
              ? chunkMin
              : Math.min(session.historySyncMeta.oldestTs, chunkMin);
        }
      }

      const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
      const user = await User.findById(userId).select("waLastSyncedAt").lean();
      const fallbackCutoffTs = Math.floor((Date.now() - THREE_DAYS_MS) / 1000);
      let cutoffTs = user?.waLastSyncedAt
        ? Math.floor(new Date(user.waLastSyncedAt).getTime() / 1000)
        : fallbackCutoffTs;
      session.historySyncMeta.cutoffTs = cutoffTs;

      // ── Percent calculate karo: kitna gap (newest → cutoff) cover ho chuka hai ──
      let percent = 0;
      const { newestTs, oldestTs } = session.historySyncMeta;
      if (newestTs !== null && oldestTs !== null) {
        const totalSpan = newestTs - cutoffTs;
        const coveredSpan = newestTs - oldestTs;
        if (totalSpan <= 0) {
          percent = 100; // cutoff hi newest ke bahut kareeb hai — turant done
        } else {
          percent = Math.round(Math.min(100, Math.max(0, (coveredSpan / totalSpan) * 100)));
        }
      }

      io.to(`user_${userId}`).emit("wa-history-sync", { status: "syncing", percent });

      // ── Contacts backfill: naam + profile picture — sabke liye, purane/naye sabko chahiye ──
      if (Array.isArray(contacts) && contacts.length > 0) {
        for (const contact of contacts) {
          const waName = contact.name || contact.notify || contact.verifiedName || "";
          upsertWhatsappContact(io, sock, session, userId, contact.id, waName).catch(() => {});
        }
      }

      if (Array.isArray(messages) && messages.length > 0) {
        let recentMessages = messages.filter((msg) => {
          const ts = Number(msg.messageTimestamp?.low ?? msg.messageTimestamp ?? 0);
          return ts >= cutoffTs;
        });

        if (recentMessages.length === 0 && messages.length > 0 && cutoffTs !== fallbackCutoffTs) {
          logger.warn?.(
            `[HISTORY SYNC] All ${messages.length} messages skipped with stale cutoff, retrying with 3-day fallback for userId ${userId}`,
          );
          cutoffTs = fallbackCutoffTs;
          recentMessages = messages.filter((msg) => {
            const ts = Number(msg.messageTimestamp?.low ?? msg.messageTimestamp ?? 0);
            return ts >= cutoffTs;
          });
        }

        logger.info(
          `[SYNC] cutoff=${new Date(cutoffTs * 1000).toISOString()} totalFromWA=${messages.length} withinCutoff=${recentMessages.length} skippedTooOld=${messages.length - recentMessages.length} percent=${percent}%`,
        );

        // Batches mein parallel process karo — bada history-sync fast ho
        const BATCH_SIZE = 15;
        for (let i = 0; i < recentMessages.length; i += BATCH_SIZE) {
          const batch = recentMessages.slice(i, i + BATCH_SIZE);
          await Promise.allSettled(
            batch.map((msg) =>
              processIncomingMessage(sock, session, io, userId, msg).catch((err) =>
                logger.error?.(`[messaging-history.set] item error: ${err.message}`),
              ),
            ),
          );
        }
      }

      if (isLatest) {
        await User.findByIdAndUpdate(userId, { waLastSyncedAt: new Date() }).catch(() => {});
        io.to(`user_${userId}`).emit("wa-history-sync", { status: "completed", percent: 100 }); 
        session.historySyncMeta = null; // agli baar ke liye reset
      }
    });

    /* ── Naam/DP baad mein bhi update hote rehte hain — realtime capture karo ── */
    sock.ev.on("contacts.upsert", (contacts) => {
      for (const contact of contacts) {
        const waName = contact.name || contact.notify || contact.verifiedName || "";
        upsertWhatsappContact(io, sock, session, userId, contact.id, waName).catch(() => {});
      }
    });

    sock.ev.on("contacts.update", (updates) => {
      for (const update of updates) {
        const waName = update.name || update.notify || update.verifiedName || "";
        upsertWhatsappContact(io, sock, session, userId, update.id, waName).catch(() => {});
      }
    });

    sock.ev.on("messages.update", async (updates) => {
  for (const update of updates) {
    try {
    const messageId = update.key?.id;
    const statusCode = update.update?.status;
    
    if (!messageId || statusCode === undefined) continue;

        let mappedStatus;
        if (statusCode === 3) mappedStatus = "delivered";
        else if (statusCode === 4 || statusCode === 5) mappedStatus = "read";
        else continue;

        await updateMessageStatusSafely(messageId, mappedStatus, io);
    } catch (err) {
      logger.error?.(`[messages.update] item error: ${err.message}`);
    }
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
        io.emit("wa-typing", {
          leadId: lead?._id ? lead._id.toString() : null,
          phone: last10,
          state: lastKnown,
        });
      })
      .catch((err) => {
        logger.error?.(`[presence.update] Lead lookup error: ${err.message}`);
      });
  } catch (e) {
    logger.error?.(`[presence.update] handler error: ${e.message}`);
  }
});

    /* ── Read receipts jab chat already open ho, alag event se aate hain ── */
    sock.ev.on("message-receipt.update", async (updates) => {
      for (const { key, receipt } of updates) {
        try {
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
        } catch (err) {
          logger.error?.(`[message-receipt.update] item error: ${err.message}`);
        }
      }
    });

    sock.ev.on("call", async (calls) => {
      logger.info?.(`[Call Event] Received ${calls.length} call event(s): ${JSON.stringify(calls)}`);
      for (const call of calls) {
        try {
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
        })
          .sort({ createdAt: -1 })
          .lean();

        const organization = lead?.organization || (await getSessionOrganization(session, userId));
        if (!organization) {
          logger.warn?.(`[Call Event] No organization resolved for call from ${resolvedNumber}`);
          continue;
        }

        const saved = await WhatsappMessage.create({
          leadId: lead?._id || null,
          organization,
          type: "call",
          direction: "incoming",
          callType,
          phone: resolvedNumber,
          status: "received",
          source: "baileys",
          metaMessageId: callId,
          waUserId: userId,
        });

        const roomKey = lead ? `lead_${lead._id}` : `wa_${last10}`;
        io.to(roomKey).emit("wa-new-message", saved);
        } catch (err) {
          logger.error?.(`[call] item error: ${err.message}`);
        }
      }
    });

    session.isInitializing = false;
  } catch (err) {
    session.isInitializing = false;
    console.error(`[Baileys] initBaileys failed for user ${userId}:`, err?.message || err);
    io.to(`user_${userId}`).emit("wa-connect-error", {
      message: err?.message || "Failed to initialize WhatsApp connection",
    });
  }
};

export const sendBaileysMessage = async (userId, phone, text, quotedRaw = null) => {
  const session = sessions.get(userId);
  if (!session?.sock || !session.isConnected) {
    throw new Error("Baileys not connected");
  }

  const rawRecipient = String(phone || "");
  const jid = rawRecipient.includes("@")
    ? rawRecipient
    : `${rawRecipient}@s.whatsapp.net`;

  await session.sock.presenceSubscribe(jid).catch(() => {});
  const options = quotedRaw ? { quoted: quotedRaw } : undefined;

  try {
    const result = await session.sock.sendMessage(jid, { text }, options);
    return result;
  } catch (err) {
    const isSessionError = /no sessions|bad mac|session error|decrypt/i.test(err?.message || "");
    if (!isSessionError) throw err;

    // Signal session corrupt — fresh presence + retry ek baar
    logger.warn?.(`[sendBaileysMessage] Session error for ${jid}, retrying: ${err.message}`);
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const retryResult = await session.sock.sendMessage(jid, { text }, options);
      return retryResult;
    } catch (retryErr) {
      throw new Error(`Message send failed after retry: ${retryErr.message}`);
    }
  }
};

export const getBaileysStatus = (userId) => {
  const session = sessions.get(userId);
  // Derive accountJid and accountPhone (last 10 digits) if available
  const accountJid = session?.sock?.user?.id || session?.sock?.user?.jid || null;
  let accountPhone = null;
  try {
    if (accountJid) {
      const digits = String(accountJid).replace(/\D/g, "");
      accountPhone = digits.slice(-10);
    }
  } catch (e) {}

  return {
    isConnected: session?.isConnected || false,
    currentQR: session?.currentQR || null,
    accountJid: accountJid || session?.accountJid || null,
    accountPhone: accountPhone || session?.accountPhone || null,
  };
};

export const logoutBaileysSession = async (userId) => {
  const session = sessions.get(userId);
  if (!session?.sock || !session.isConnected) {
    await deleteMongoAuthState(userId).catch(() => {});
    // await User.findByIdAndUpdate(userId, { $unset: { waLastSyncedAt: "" } }).catch(() => {});
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
    logger.warn?.(`[logout] sock.logout() failed, cleaning up anyway: ${error.message}`);
  } finally {
    await deleteMongoAuthState(userId).catch(() => {});
    // await User.findByIdAndUpdate(userId, { $unset: { waLastSyncedAt: "" } }).catch(() => {});
    if (session) {
      session.sock = null;
      session.isConnected = false;
      session.currentQR = null;
    }
    // ab throw nahi karenge — cleanup ho gaya, user ko error dikhane ki zaroorat nahi
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
