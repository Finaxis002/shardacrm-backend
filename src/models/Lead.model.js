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
    isDuplicate: {
      type: Boolean,
      default: false,
    },
    managerId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "User",
  default: null,
},
  },
  { timestamps: true },
);

// Index for faster queries
leadSchema.index({ organization: 1, assignedTo: 1 });
leadSchema.index({ organization: 1, status: 1 });
leadSchema.index({ organization: 1, createdAt: -1 });

const Lead = mongoose.model("Lead", leadSchema);
export default Lead;
