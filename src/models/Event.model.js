import mongoose from "mongoose";

const eventSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Event title is required"],
      trim: true,
    },
    eventDate: {
      type: String, // "YYYY-MM-DD"
      required: [true, "Event date is required"],
    },
    eventTime: {
      type: String, // "HH:MM"
      default: "10:00",
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
    isDone: {
      type: Boolean,
      default: false,
    },
    assignedTo: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: [true, "Assigned user is required"],
      },
    ],
    doneBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    doneAt: {
      type: Date,
      default: null,
    },
    googleCalendarEvents: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        eventId: {
          type: String,
          required: true,
        },
        calendarId: {
          type: String,
          default: "primary",
        },
        syncStatus: {
          type: String,
          enum: ["synced", "deleted"],
          default: "synced",
        },
        lastSyncedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

eventSchema.index({ organization: 1, eventDate: 1 });
eventSchema.index({ organization: 1, assignedTo: 1 });
eventSchema.index({ "googleCalendarEvents.eventId": 1 });

const Event = mongoose.model("Event", eventSchema);
export default Event;
