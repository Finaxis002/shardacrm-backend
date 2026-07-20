import mongoose from "mongoose";

const whatsappSignalKeySchema = new mongoose.Schema(
  {
    // WhatsAppSession.userId String hai (ObjectId nahi) — isliye yahan bhi
    // String rakha hai taaki dono jagah exact match ho query mein.
    userId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    category: {
      type: String,
      required: true,
    },
    keyId: {
      type: String,
      required: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
    minimize: false,
  },
);

whatsappSignalKeySchema.index(
  { userId: 1, category: 1, keyId: 1 },
  { unique: true },
);

const WhatsAppSignalKey = mongoose.model(
  "WhatsAppSignalKey",
  whatsappSignalKeySchema,
);

export default WhatsAppSignalKey;