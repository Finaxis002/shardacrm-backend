import mongoose from "mongoose";

// ─── Cross-Sell Recommendation Engine Rules ──────────────────────────────────
// Configurable per organization. Seeded with defaults on first use.

const crossSellRuleSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    // The service/product that TRIGGERS recommendations
    triggerService: {
      type: String,
      required: true,
      trim: true,
    },
    // Array of recommended services with pitch
    recommendations: [
      {
        service: { type: String, required: true, trim: true },
        pitch: { type: String, default: "" },       // Sales pitch for this service
        priority: { type: Number, default: 1 },     // Higher = shown first
        isActive: { type: Boolean, default: true },
      },
    ],
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

crossSellRuleSchema.index({ organization: 1, triggerService: 1 });

// ─── Cross-Sell Lead Record ───────────────────────────────────────────────────

const crossSellLeadSchema = new mongoose.Schema(
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
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    // Original service the lead came in for
    originalService: { type: String, default: "" },

    // Each recommended service and its outcome
    recommendations: [
      {
        service: { type: String, required: true },
        pitch: { type: String, default: "" },
        status: {
          type: String,
          enum: ["Pending", "Interested", "Not Interested", "Converted"],
          default: "Pending",
        },
        respondedAt: { type: Date, default: null },
        respondedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        followUpTaskId: { type: mongoose.Schema.Types.ObjectId, default: null },
        notes: { type: String, default: "" },
      },
    ],

    // Auto follow-up task created?
    autoTaskCreated: { type: Boolean, default: false },

    // WhatsApp/Email automation triggered?
    automationSent: { type: Boolean, default: false },
    automationSentAt: { type: Date, default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

crossSellLeadSchema.index({ leadId: 1 });
crossSellLeadSchema.index({ organization: 1, createdAt: -1 });
crossSellLeadSchema.index({ organization: 1, "recommendations.status": 1 });

export const CrossSellRule = mongoose.model("CrossSellRule", crossSellRuleSchema);
export const CrossSellLead = mongoose.model("CrossSellLead", crossSellLeadSchema);

// ─── Scheduled Emails for cross-sell automation ─────────────────────────────
const scheduledEmailSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: false },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true },
    to: { type: String, required: true },
    subject: { type: String, default: "" },
    html: { type: String, default: "" },
    scheduledAt: { type: Date, required: true },
    status: { type: String, enum: ["pending", "processing", "sent", "failed", "cancelled"], default: "pending" },
    sentAt: { type: Date, default: null },
    error: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

scheduledEmailSchema.index({ organization: 1, scheduledAt: 1, status: 1 });

export const ScheduledEmail = mongoose.model("ScheduledEmail", scheduledEmailSchema);