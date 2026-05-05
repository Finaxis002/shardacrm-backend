import mongoose from "mongoose";

const distributionRuleSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    // Selected sheet sync IDs
    sheetSyncIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "GoogleSheetSync",
      },
    ],
    rule: {
      type: String,
      enum: ["round_robin", "equal_load", "manual"],
      default: "round_robin",
    },
    // Users in the pool
    userPool: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    // For round robin - track current index
    rrIndex: {
      type: Number,
      default: 0,
    },
    // For equal_load - track lead count per user
    leadCounts: {
      type: Map,
      of: Number,
      default: new Map(),
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

distributionRuleSchema.index({ organization: 1 });
distributionRuleSchema.index({ sheetSyncIds: 1 });

const DistributionRule = mongoose.model("DistributionRule", distributionRuleSchema);
export default DistributionRule;