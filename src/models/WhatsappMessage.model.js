import mongoose from "mongoose";

const whatsappMessageSchema = new mongoose.Schema(
  {
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      required: true,
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    type: {
      type: String,
      enum: ["chat", "call"],
      default: "chat",
    },
    callType: {
      type: String,
      enum: ["incoming", "outgoing", "missed", "video"],
      default: null,
    },
    direction: {
      type: String,
      enum: ["outgoing", "incoming"],
      required: true,
    },
    body: {
      type: String,
      default: "",
    },
    phone: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["sent", "delivered", "read", "failed", "received"],
      default: "sent",
    },
    source: {
      type: String,
      enum: ["cloud_api", "baileys"],
      default: "cloud_api",
    },
    metaMessageId: {
      type: String,
      default: "",
    },
    mediaUrl: {
      type: String,
      default: "",
    },
    mediaName: {
      type: String,
      default: "",
    },
    isVoiceNote: {
      type: Boolean,
      default: false,
    },
    waSenderName: {
      type: String,
      default: null,
    },
    sentBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    waUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    receivedAt: {
      type: Date,
      default: null,
    },
    metaResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    fallback: {
      type: Boolean,
      default: false,
    },
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsappMessage",
      default: null,
    },
    waMessageRaw: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    readByAgent: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);
// fast query for lead timeline
whatsappMessageSchema.index({ leadId: 1, createdAt: -1 });
// prevent duplicate messages when multiple sockets/processes handle the same upstream event
// `sparse: true` allows documents without metaMessageId to exist
whatsappMessageSchema.index({ metaMessageId: 1 }, { unique: true, sparse: true });

const WhatsappMessage = mongoose.model(
  "WhatsappMessage",
  whatsappMessageSchema,
);

export default WhatsappMessage;