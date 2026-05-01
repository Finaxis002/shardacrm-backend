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

    // Pipeline stages embedded in settings
    pipelineStages: [
      {
        name: {
          type: String,
          required: true,
          trim: true,
        },
        color: {
          type: String,
          default: "#6b7280",
        },
        order: {
          type: Number,
          default: 0,
        },
      },
    ],

    // RBAC
    permissions: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    rbacExecOnly: {
      type: Boolean,
      default: true,
    },
    rbacCoEditorsCanEdit: {
      type: Boolean,
      default: true,
    },

    // Lead columns
    leadColumns: {
      type: [String],
      default: ["name", "phone", "source", "value", "status", "assign"],
    },
    customColumns: {
      type: [
        {
          key: String,
          label: String,
          visible: Boolean,
        },
      ],
      default: [],
    },

    // Google Calendar
    gcalConnected: {
      type: Boolean,
      default: false,
    },
    gcalUser: String,
    gmailEnabled: {
      type: Boolean,
      default: false,
    },

    // Payment Gateways
    gateways: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    defaultGateway: {
      type: String,
      default: "",
    },
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
    aiKey: {
      type: String,
      default: "",
    },
    aiModel: {
      type: String,
      default: "",
    },
    aiEndpoint: {
      type: String,
      default: "",
    },
    aiPrompt: {
      type: String,
      default: "",
    },
    aiAutoAnalyse: {
      type: Boolean,
      default: false,
    },
    aiScanNotes: {
      type: Boolean,
      default: true,
    },
    aiIntent: {
      type: Boolean,
      default: false,
    },

    // General
    companyName: {
      type: String,
      default: "",
    },
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
