import mongoose from "mongoose";

const settingsSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      unique: true,
    },

    // Distribution settings
    distributionMethod: {
      type: String,
      enum: ["round_robin", "equal_load", "manual"],
      default: "round_robin",
    },
    distributionPool: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    rrIndex: {
      type: Number,
      default: 0,
    },

    // Pipeline
    pipelineStages: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "PipelineStage",
      },
    ],

    // RBAC
    permissions: mongoose.Schema.Types.Mixed,
    rbacExecOnly: {
      type: Boolean,
      default: true,
    },
    rbacCoEditorsCanEdit: {
      type: Boolean,
      default: true,
    },

    // Lead columns
    leadColumns: [String],
    customColumns: [
      {
        key: String,
        label: String,
        visible: Boolean,
      },
    ],

    // Google Calendar
    gcalConnected: {
      type: Boolean,
      default: false,
    },
    gcalUser: String,

    // Payment Gateways
    gateways: mongoose.Schema.Types.Mixed,
    defaultGateway: String,
    paymentLinkExpiry: {
      type: Number,
      default: 48,
    },

    // AI Settings
    aiProvider: {
      type: String,
      enum: ["openai", "anthropic", "gemini", "custom", ""],
      default: "",
    },
    aiKey: String,
    aiModel: String,
    aiPrompt: String,
    aiAutoAnalyse: Boolean,
    aiScanNotes: Boolean,
    aiIntent: Boolean,

    // General
    companyName: String,
    currency: {
      type: String,
      default: "₹",
    },
    timezone: {
      type: String,
      default: "Asia/Kolkata",
    },
  },
  { timestamps: true },
);

const Settings = mongoose.model("Settings", settingsSchema);
export default Settings;
