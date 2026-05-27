import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
    },
    title: {
      type: String,
      required: true,
    },
    message: String,
    type: {
      type: String,
      enum: [
        // Existing types (unchanged)
        "assignment",
        "status_change",
        "payment",
        "reminder",
        "mention",
        "system",
        "lead_created",
        "lead_assigned",
        "lead_updated",
        "lead_deleted",
        "lead_reassigned",
        "lead_status_changed",
        "lead_co_assignee_added",

        // New activity-specific types
        "activity_note",
        "activity_call",
        "activity_email",
        "activity_meeting",
        "activity_task",

        // New payment-specific types
        "payment_created",
        "payment_updated",

        // New recording-specific types
        "recording_added",
        "recording_updated",
        "recording_deleted",

        // New reminder-specific types
        "reminder_created",
        "reminder_updated",
        "reminder_deleted",
      ],
      default: "system",
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    readAt: Date,
    actionUrl: String,
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
  },
  { timestamps: true },
);

notificationSchema.index({ recipientId: 1, createdAt: -1 });
notificationSchema.index({ recipientId: 1, isRead: 1 });

const Notification = mongoose.model("Notification", notificationSchema);
export default Notification;
