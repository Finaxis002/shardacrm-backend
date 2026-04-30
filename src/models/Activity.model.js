import mongoose from "mongoose";

const activitySchema = new mongoose.Schema(
  {
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      required: true,
    },
    type: {
      type: String,
      enum: [
        "Call",
        "Note",
        "Email",
        "Meeting",
        "Recording",
        "Task",
        "Status Change",
      ],
      required: true,
    },
    text: {
      type: String,
      default: "",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },

    // For Calls
    callDuration: String,
    callDirection: {
      type: String,
      enum: ["Outgoing", "Incoming", "Missed"],
    },
    callOutcome: {
      type: String,
      enum: ["Spoke", "No Answer", "Left Voicemail"],
    },

    // For Recordings
    recordingUrl: String,
    recordingDuration: String,
    recordingSize: String,
    aiAnalysis: {
      intent: String,
      redFlags: [String],
      objections: [String],
      nextSteps: [String],
    },

    // For Tasks
    taskDueDate: Date,
    taskAssignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    taskCompleted: {
      type: Boolean,
      default: false,
    },

    // For Status Changes
    statusFrom: String,
    statusTo: String,

    // For Email
    emailSubject: String,
    emailBody: String,

    // Notifications
    notifiedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  { timestamps: true },
);

// Index for faster queries
activitySchema.index({ leadId: 1, createdAt: -1 });
activitySchema.index({ organization: 1, createdAt: -1 });

const Activity = mongoose.model("Activity", activitySchema);
export default Activity;
