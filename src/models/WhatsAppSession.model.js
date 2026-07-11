import mongoose from "mongoose";

const whatsappSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    creds: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    keys: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastActiveAt: {
      type: Date,
      default: Date.now,
    },
    lastError: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    minimize: false,
  },
);

const WhatsAppSession = mongoose.model("WhatsAppSession", whatsappSessionSchema);

export default WhatsAppSession;
