import mongoose from "mongoose";

const leadSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Lead name is required"],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, "Phone is required"],
      sparse: true,
    },
    alternatePhone: {
      type: String,
      default: "",
    },
    email: {
      type: String,
      lowercase: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, "Invalid email"],
      sparse: true,
    },
    city: {
      type: String,
      default: "",
    },
    source: {
      type: String,
      enum: [
        "Google Ads",
        "Website",
        "Referral",
        "Walk-in",
        "Cold Call",
        "Social Media",
        "Google Sheet",
        "Meta Ads",
        "Other",
      ],
      default: "Other",
    },
    status: {
      type: String,
      default: "New",
    },
    dealValue: {
      type: Number,
      default: 0,
    },
    product: {
      type: String,
      default: "",
    },
    closeDate: {
      type: Date,
      default: null,
    },
     closedAt: {
      type: Date,
      default: null,
    },
    recordingsDeletedAt: {
      type: Date,
      default: null,
    },
    initialNote: {
      type: String,
      default: "",
    },
    priority: {
      type: String,
      enum: ["Normal", "High", "Urgent"],
      default: "Normal",
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    coAssignees: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    recording: {
      label: { type: String, default: "" },
      url: { type: String, default: "" },
    },
    recordings: [
      {
        label: { type: String, default: "" },
        url: { type: String, default: "" },
        filename: { type: String, default: "" },
        originalName: { type: String, default: "" },
        mimeType: { type: String, default: "" },
        size: { type: Number, default: 0 },
        uploadedAt: { type: Date, default: Date.now },
        uploadedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },

    // AI Analysis
    transcript: {
      type: String,
      default: "",
    },
    summary: {
      type: String,
      default: "",
    },
    intent: {
      type: String,
      default: "",
    },
    redFlags: [
      {
        type: String,
      },
    ],
    objections: [
      {
        type: String,
      },
    ],
    nextSteps: [
      {
        type: String,
      },
    ],
  },
],
    customFields: {
      type: Map,
      of: String,
      default: new Map(),
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    sheetName: {
      type: String,
      default: "",
    },
    metaAdId: {
      type: String,
      default: "",
    },
    metaFormId: {
      type: String,
      default: "",
    },
    metaAdName: {
      type: String,
      default: "",
    },
    isDuplicate: {
      type: Boolean,
      default: false,
    },
    managerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    isCrossSell: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

// Index for faster queries
leadSchema.index({ organization: 1, assignedTo: 1 });
leadSchema.index({ organization: 1, status: 1 });
leadSchema.index({ organization: 1, createdAt: -1 });
leadSchema.index({ organization: 1, priority: 1, createdAt: -1 });
leadSchema.index({ organization: 1, closeDate: -1 });
leadSchema.index({ organization: 1, createdAt: -1, priority: 1 });
leadSchema.index({ organization: 1, status: 1, priority: 1 });

const Lead = mongoose.model("Lead", leadSchema);
export default Lead;
