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
    sentBy: {
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
  },
  { timestamps: true },
);

whatsappMessageSchema.index({ leadId: 1, createdAt: -1 });

const WhatsappMessage = mongoose.model(
  "WhatsappMessage",
  whatsappMessageSchema,
);

export default WhatsappMessage;
