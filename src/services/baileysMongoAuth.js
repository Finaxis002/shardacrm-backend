import { initAuthCreds } from "@whiskeysockets/baileys/lib/Utils/auth-utils.js";
import { BufferJSON } from "@whiskeysockets/baileys/lib/Utils/generics.js";
import WhatsAppSession from "../models/WhatsAppSession.model.js";

/* ── Per-user write queue — taaki concurrent get/set/clear calls ek dusre ko
     overwrite na karein (race condition hi "Bad MAC" / session corruption ki asli wajah hai) ── */
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

const buildSignalKeyStore = (userId) => ({
  async get(type, ids) {
    return enqueue(userId, async () => {
      const doc = await getSessionDoc(userId);
      const stored = doc?.keys?.[type] || {};
      const result = {};

      for (const id of ids) {
        const entry = stored[id];
        if (entry) {
          result[id] = restoreValue(entry);
        }
      }

      return result;
    });
  },
  async set(data) {
    return enqueue(userId, async () => {
      const currentDoc = await getSessionDoc(userId);
      const existingKeys = currentDoc?.keys || {};
      const nextKeys = { ...existingKeys };

      for (const category in data) {
        const payload = data[category] || {};
        nextKeys[category] = { ...(nextKeys[category] || {}) };

        for (const id in payload) {
          const value = payload[id];
          if (value) {
            nextKeys[category][id] = normalizeValue(value);
          } else {
            delete nextKeys[category][id];
          }
        }
      }

      await upsertSessionDoc(userId, { keys: nextKeys });
    });
  },
  async clear() {
    return enqueue(userId, async () => {
      await upsertSessionDoc(userId, { keys: {} });
    });
  },
});

export const useMongoAuthState = async (userId) => {
  const existingDoc = await getSessionDoc(userId);
  const initialCreds = existingDoc?.creds ? restoreValue(existingDoc.creds) : initAuthCreds();

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
};
