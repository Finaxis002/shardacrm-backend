import mongoose from "mongoose";

const pipelineStageSchema = new mongoose.Schema(
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
    color: {
      type: String,
      default: "#6b7280",
    },
    order: {
      type: Number,
      default: 0,
    },
    description: String,
    isDefault: Boolean,
  },
  { timestamps: true },
);

pipelineStageSchema.index({ organization: 1, order: 1 });

const PipelineStage = mongoose.model("PipelineStage", pipelineStageSchema);
export default PipelineStage;
