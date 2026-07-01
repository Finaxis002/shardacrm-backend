import mongoose from "mongoose";

const callLogSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      default: null,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    phoneNumber: { type: String, required: true, trim: true },
    callType: {
      type: String,
      enum: ["Incoming", "Outgoing", "Missed", "No Answer", "Rejected"],
      required: true,
    },
    duration: { type: Number, default: 0 },
    callTimestamp: { type: Date, required: true },
    recordingUrl: { type: String, default: null },
    recordingUploaded: { type: Boolean, default: false },
    deviceCallId: { type: String, default: null },
  },
  { timestamps: true },
);

callLogSchema.index({ organization: 1, lead: 1, callTimestamp: -1 });
callLogSchema.index(
  { user: 1, deviceCallId: 1 },
  { unique: true, sparse: true },
);

const CallLog = mongoose.model("CallLog", callLogSchema);
export default CallLog;
