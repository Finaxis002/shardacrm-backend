import mongoose from "mongoose";

const reminderSchema = new mongoose.Schema(
  {
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      required: true,
    },
    type: {
      type: String,
      enum: ["Call", "Email", "Meeting", "Follow-up", "Payment"],
      required: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reminderDate: {
      type: Date,
      required: true,
    },
    reminderTime: String, // HH:mm format
    note: String,
    isDone: {
      type: Boolean,
      default: false,
    },
    doneAt: Date,
    doneBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    googleCalendarEventId: String,
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    notifyUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  { timestamps: true },
);

// Index for reminders that need to be sent
reminderSchema.index({ reminderDate: 1, isDone: 1 });
reminderSchema.index({ assignedTo: 1, reminderDate: -1 });

const Reminder = mongoose.model("Reminder", reminderSchema);
export default Reminder;
