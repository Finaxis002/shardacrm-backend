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
    distributionPool: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    rrIndex: { type: Number, default: 0 },

    // Pipeline stages
    pipelineStages: [
      {
        name: { type: String, required: true, trim: true },
        color: { type: String, default: "#6b7280" },
        order: { type: Number, default: 0 },
      },
    ],

    // RBAC
    permissions: { type: mongoose.Schema.Types.Mixed, default: {} },
    rbacExecOnly: { type: Boolean, default: true },
    rbacCoEditorsCanEdit: { type: Boolean, default: true },

    // Lead columns
    leadColumns: {
      type: [String],
      default: ["name", "phone", "source", "value", "status", "assign"],
    },
    customColumns: {
      type: [
        {
          key: { type: String },
          label: { type: String },
          visible: { type: Boolean, default: true },
          formVisible: { type: Boolean, default: true },
        },
      ],
      default: [],
    },

    // ── Google Calendar ──
    gcalConnected: { type: Boolean, default: false },
    gcalUser: { type: String, default: "" },
    gcalTokens: {
      access_token: { type: String, default: "" },
      refresh_token: { type: String, default: "" },
      expiry_date: { type: Number, default: 0 },
      token_type: { type: String, default: "" },
      scope: { type: String, default: "" },
    },
    gmailEnabled: { type: Boolean, default: false },

    // Payment Gateways
    gateways: { type: mongoose.Schema.Types.Mixed, default: {} },
    defaultGateway: { type: String, default: "" },
    paymentLinkExpiry: { type: Number, default: 48 },

    // ── AI Configuration (Multi-Provider) ──
    ai: {
      type: {
        gemini: {
          enabled: { type: Boolean, default: false },
          key: { type: String, default: "", select: false },
          model: { type: String, default: "gemini-2.5-flash" },
        },
        groq: {
          enabled: { type: Boolean, default: false },
          key: { type: String, default: "", select: false },
          model: { type: String, default: "whisper-large-v3" },
        },
        autoAnalyse: { type: Boolean, default: false },
        autoAnalyseCallLogs: { type: Boolean, default: true },
        prompt: { type: String, default: "" },
        scanNotes: { type: Boolean, default: true },
      },
      default: {
        gemini: { enabled: false, key: "", model: "gemini-2.5-flash" },
        groq: { enabled: false, key: "", model: "whisper-large-v3" },
        autoAnalyse: false,
        autoAnalyseCallLogs: true,
        prompt: "",
        scanNotes: true,
      },
    },

    // General
    companyName: { type: String, default: "" },
    currency: { type: String, default: "₹" },
    timezone: { type: String, default: "Asia/Kolkata" },
  },
  { timestamps: true },
);

const Settings = mongoose.model("Settings", settingsSchema);
export default Settings;
