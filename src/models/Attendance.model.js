import mongoose from "mongoose";

const attendanceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    date: {
      type: String, // "YYYY-MM-DD"
      required: true,
    },
    checkIn: {
      type: String, // "HH:MM"
      default: null,
    },
    checkOut: {
      type: String, // "HH:MM"
      default: null,
    },
    status: {
      type: String,
      enum: ["present", "absent", "half-day"],
      default: "present",
    },
    markedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

attendanceSchema.index({ userId: 1, date: 1 }, { unique: true });

export default mongoose.model("Attendance", attendanceSchema);