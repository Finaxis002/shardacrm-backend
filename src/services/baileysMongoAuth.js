import { initAuthCreds } from "@whiskeysockets/baileys/lib/Utils/auth-utils.js";
import { BufferJSON } from "@whiskeysockets/baileys/lib/Utils/generics.js";
import WhatsAppSession from "../models/WhatsAppSession.model.js";
import WhatsAppSignalKey from "../models/WhatsAppSignalKey.model.js";

/* ── creds ke liye per-user write queue — taaki concurrent saveCreds() calls
     ek dusre ko overwrite na karein ── */
const userQueues = new Map();

const enqueue = (userId, task) => {
  const prev = userQueues.get(userId) || Promise.resolve();
  const next = prev.then(task, task);
  userQueues.set(userId, next);
  return next;
};

const normalizeValue = (value) => {
  if (value && typeof value === "object") {
    return JSON.parse(JSON.stringify(value, BufferJSON.replacer));
  }
  return value;
};

const restoreValue = (value) => {
  if (value && typeof value === "object") {
    return JSON.parse(JSON.stringify(value), BufferJSON.reviver);
  }
  return value;
};

const getSessionDoc = async (userId) => {
  const doc = await WhatsAppSession.findOne({ userId }).lean();
  return doc || null;
};

const upsertSessionDoc = async (userId, update) => {
  await WhatsAppSession.findOneAndUpdate(
    { userId },
    {
      $set: {
        ...update,
        lastActiveAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
};

/* ── Signal keys ab yahan store hote hain — ek document per (userId, category, keyId).
     Na poora keys object padhna padta hai, na poora wapas likhna — sirf jo IDs
     chahiye/change hui hain unhi par query/write hoti hai. ── */
const buildSignalKeyStore = (userId) => ({
  async get(type, ids) {
    const docs = await WhatsAppSignalKey.find({
      userId,
      category: type,
      keyId: { $in: ids },
    }).lean();

    const result = {};
    for (const doc of docs) {
      result[doc.keyId] = restoreValue(doc.value);
    }
    return result;
  },

  async set(data) {
    const ops = [];

    for (const category in data) {
      const payload = data[category] || {};
      for (const id in payload) {
        const value = payload[id];
        if (value) {
          ops.push({
            updateOne: {
              filter: { userId, category, keyId: id },
              update: { $set: { value: normalizeValue(value) } },
              upsert: true,
            },
          });
        } else {
          ops.push({
            deleteOne: { filter: { userId, category, keyId: id } },
          });
        }
      }
    }

    if (ops.length) {
      await WhatsAppSignalKey.bulkWrite(ops, { ordered: false });
    }
  },

  async clear() {
    await WhatsAppSignalKey.deleteMany({ userId });
  },
});

export const useMongoAuthState = async (userId) => {
  const existingDoc = await getSessionDoc(userId);
  const initialCreds = existingDoc?.creds
    ? restoreValue(existingDoc.creds)
    : initAuthCreds();

  const state = {
    creds: initialCreds,
    keys: buildSignalKeyStore(userId),
  };

  const saveCreds = async () => {
    await enqueue(userId, async () => {
      await upsertSessionDoc(userId, { creds: normalizeValue(state.creds) });
    });
  };

  return { state, saveCreds };
};

export const deleteMongoAuthState = async (userId) => {
  await WhatsAppSession.deleteOne({ userId });
  await WhatsAppSignalKey.deleteMany({ userId });
};