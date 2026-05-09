import Attendance from "../models/Attendance.model.js";
import User from "../models/User.model.js";
import nodemailer from "nodemailer";
import crypto from "crypto";
import { config } from "../config/env.js";
// ─── helpers ──────────────────────────────────────────────────────────────────
const dateStr = (d = new Date()) =>
  d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const timeStr = (d = new Date()) =>
  d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });

// ─── In-memory OTP store ───────────────────────────────────────────────────────
// { userId: { otp: "123456", expiresAt: timestamp } }
const otpStore = new Map();

// ─── Nodemailer transporter ───────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: config.attendance.email,
    pass: config.attendance.pass,
  },
  connectionTimeout: 60000,
  socketTimeout: 60000,
});

// ─── OTP: Request ─────────────────────────────────────────────────────────────
export const requestAttendanceOtp = async (req, res) => {
  try {
    const userId = req.user._id;
    const today = dateStr();

    // Already marked today?
    const existing = await Attendance.findOne({ userId, date: today });
    if (existing) {
      return res
        .status(409)
        .json({ message: "Attendance already marked for today" });
    }

    // Find any active admin
    const admin = await User.findOne({ role: "admin", isActive: true }).lean();
    if (!admin) return res.status(404).json({ message: "No admin found" });

    // Generate 6-digit OTP
    const otp = crypto.randomInt(100000, 999999).toString();

    // Store with 5-minute expiry
    otpStore.set(userId.toString(), {
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    // Send email to admin
    await transporter.sendMail({
      from: `"Attendance System" <${config.attendance.email}>`,
      to: config.attendance.email,
      subject: `🕐 Attendance Approval Request — ${req.user.name || req.user.email} · ${today}`,
      html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Attendance OTP</title>
</head>
<body style="margin:0;padding:32px 16px;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:0.5px solid #E2E8F0">

    <!-- Top accent bar -->
    <div style="height:4px;background:linear-gradient(90deg,#4F46E5,#6366F1,#818CF8)"></div>

    <!-- Header -->
    <div style="padding:28px 32px 24px;border-bottom:1px solid #F1F5F9">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <div style="width:36px;height:36px;border-radius:8px;background:#EEF2FF;display:flex;align-items:center;justify-content:center;font-size:18px">📋</div>
        <span style="font-size:13px;color:#64748B;font-weight:500;letter-spacing:0.02em">Attendance System</span>
      </div>
      <h1 style="font-size:20px;font-weight:600;color:#0F172A;margin:0 0 6px">Attendance Approval Request</h1>
      <p style="font-size:13px;color:#64748B;margin:0;line-height:1.5">A check-in request is awaiting your approval. Please review the details below.</p>
    </div>

    <!-- Info Cards -->
    <div style="padding:24px 32px 0">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:12px 0;margin-bottom:24px">
        <tr>
          <td width="50%" style="background:#F8FAFC;border-radius:10px;border:0.5px solid #E2E8F0;padding:14px 16px;vertical-align:top">
            <div style="font-size:11px;color:#94A3B8;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:8px">Employee</div>
            <div style="display:flex;align-items:center;gap:8px">
              <div style="width:24px;height:24px;border-radius:50%;background:#EEF2FF;text-align:center;line-height:24px;font-size:11px;font-weight:600;color:#4F46E5">${(req.user.name || req.user.email || "?")[0].toUpperCase()}</div>
              <span style="font-size:14px;color:#0F172A;font-weight:500">${req.user.name || req.user.email}</span>
            </div>
          </td>
          <td width="50%" style="background:#F8FAFC;border-radius:10px;border:0.5px solid #E2E8F0;padding:14px 16px;vertical-align:top">
            <div style="font-size:11px;color:#94A3B8;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:8px">Date</div>
            <div style="font-size:14px;color:#0F172A;font-weight:500">📅 ${today}</div>
          </td>
        </tr>
      </table>

      <!-- OTP Box -->
      <div style="border:0.5px solid #C7D2FE;border-radius:14px;padding:28px 20px;margin-bottom:20px;text-align:center;background:#FAFAFE">
        <div style="font-size:11px;color:#6366F1;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:18px">One-Time Password</div>
        <table cellpadding="0" cellspacing="0" style="margin:0 auto 18px">
          <tr>
            ${otp
              .split("")
              .map(
                (d) => `
            <td style="padding:0 4px">
              <div style="width:46px;height:54px;background:#EEF2FF;border:1.5px solid #C7D2FE;border-radius:10px;text-align:center;line-height:54px;font-size:26px;font-weight:600;color:#3730A3">${d}</div>
            </td>`,
              )
              .join("")}
          </tr>
        </table>
        <div style="display:inline-flex;align-items:center;gap:6px;background:#FFF7ED;border:0.5px solid #FED7AA;border-radius:20px;padding:5px 14px">
          <span style="font-size:13px">⏱</span>
          <span style="font-size:12px;color:#EA580C;font-weight:500">Expires in <strong>5 minutes</strong></span>
        </div>
      </div>

      <!-- Warning -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#FFFBEB;border:0.5px solid #FCD34D;border-radius:10px;margin-bottom:24px">
        <tr>
          <td width="36" style="padding:14px 0 14px 16px;vertical-align:top;font-size:15px">⚠️</td>
          <td style="padding:14px 16px 14px 6px;font-size:12px;color:#64748B;line-height:1.7">
            Share this OTP <strong style="color:#0F172A">only with the employee</strong> after verifying the request is legitimate. Do not share if the request seems unauthorised.
          </td>
        </tr>
      </table>
    </div>

    <!-- Footer -->
    <div style="padding:14px 32px;border-top:1px solid #F1F5F9;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:11px;color:#94A3B8">Attendance System · Auto-generated · Do not reply</span>
      <span style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;background:#ECFDF5;color:#065F46;border:0.5px solid #A7F3D0">SECURE</span>
    </div>

  </div>
</body>
</html>
`,
    });

    res.json({ message: "OTP sent to admin email" });
  } catch (err) {
    console.error("requestAttendanceOtp:", err);
    res.status(500).json({ message: "Failed to send OTP. Please try again." });
  }
};

// ─── OTP: Verify & Mark ───────────────────────────────────────────────────────
export const verifyAttendanceOtp = async (req, res) => {
  try {
    const userId = req.user._id;
    const { otp } = req.body;

    if (!otp) return res.status(400).json({ message: "OTP is required" });

    const record = otpStore.get(userId.toString());

    if (!record) {
      return res
        .status(400)
        .json({ message: "No OTP found. Please request a new one." });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(userId.toString());
      return res
        .status(400)
        .json({ message: "OTP has expired. Please request a new one." });
    }

    if (record.otp !== otp.trim()) {
      return res
        .status(400)
        .json({ message: "Invalid OTP. Please try again." });
    }

    // OTP valid — delete it immediately (one-time use)
    otpStore.delete(userId.toString());

    const today = dateStr();

    // Double-check not already marked (race condition guard)
    const existing = await Attendance.findOne({ userId, date: today });
    if (existing) {
      return res
        .status(409)
        .json({ message: "Attendance already marked for today" });
    }

    const attendance = await Attendance.create({
      userId,
      date: today,
      checkIn: timeStr(),
      status: "present",
    });

    res
      .status(201)
      .json({ message: "Attendance marked successfully", data: attendance });
  } catch (err) {
    console.error("verifyAttendanceOtp:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// ─── Employee: View own attendance ────────────────────────────────────────────
export const markAttendance = async (req, res) => {
  try {
    const userId = req.user._id;
    const today = dateStr();
    const existing = await Attendance.findOne({ userId, date: today });
    if (existing) {
      return res
        .status(409)
        .json({ message: "Attendance already marked for today" });
    }
    const record = await Attendance.create({
      userId,
      date: today,
      checkIn: timeStr(),
      status: "present",
    });
    res.status(201).json({ message: "Attendance marked", data: record });
  } catch (err) {
    console.error("markAttendance:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const myAttendance = async (req, res) => {
  try {
    const userId = req.user._id;
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    const records = await Attendance.find({
      userId,
      date: { $regex: `^${prefix}` },
    }).lean();
    const byDate = {};
    records.forEach((r) => {
      byDate[r.date] = r;
    });
    res.json({ month, year, records: byDate });
  } catch (err) {
    console.error("myAttendance:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// ─── Admin: Monthly summary ───────────────────────────────────────────────────
export const adminMonthly = async (req, res) => {
  try {
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    const totalUsers = await User.countDocuments({ isActive: true });
    const records = await Attendance.find({
      date: { $regex: `^${prefix}` },
      status: "present",
    }).lean();
    const presentByDate = {};
    records.forEach((r) => {
      presentByDate[r.date] = (presentByDate[r.date] || 0) + 1;
    });
    const summary = {};
    Object.entries(presentByDate).forEach(([date, present]) => {
      summary[date] = { present, absent: totalUsers - present };
    });
    res.json({ month, year, totalUsers, summary });
  } catch (err) {
    console.error("adminMonthly:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// ─── Admin: Day detail ────────────────────────────────────────────────────────
export const adminDayDetail = async (req, res) => {
  try {
    const date = req.query.date || dateStr();
    const presentRecords = await Attendance.find({ date, status: "present" })
      .populate("userId", "name email phone role")
      .lean();
    const validPresent = presentRecords.filter((r) => r.userId);
    const presentIds = validPresent.map((r) => r.userId._id.toString());
    const absentUsers = await User.find({
      isActive: true,
      _id: { $nin: presentIds },
    })
      .select("name email phone role")
      .lean();
    res.json({
      date,
      present: validPresent.map((r) => ({
        _id: r.userId._id,
        name: r.userId.name,
        email: r.userId.email,
        phone: r.userId.phone,
        role: r.userId.role,
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        status: r.status,
      })),
      absent: absentUsers,
      presentCount: validPresent.length,
      absentCount: absentUsers.length,
    });
  } catch (err) {
    console.error("adminDayDetail:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// ─── Admin: Single user monthly ───────────────────────────────────────────────
export const adminUserMonthly = async (req, res) => {
  try {
    const { userId } = req.params;
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    const user = await User.findById(userId)
      .select("name email phone role")
      .lean();
    if (!user) return res.status(404).json({ message: "User not found" });
    const records = await Attendance.find({
      userId,
      date: { $regex: `^${prefix}` },
    }).lean();
    const byDate = {};
    records.forEach((r) => {
      byDate[r.date] = r;
    });
    res.json({ month, year, user, records: byDate });
  } catch (err) {
    console.error("adminUserMonthly:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// ─── Admin: Get all users ─────────────────────────────────────────────────────
export const getAllUsers = async (req, res) => {
  try {
    const { search } = req.query;
    const filter = { isActive: true };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }
    const users = await User.find(filter)
      .select("name email phone role")
      .lean();
    res.json(users);
  } catch (err) {
    console.error("getAllUsers:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// ─── Admin: Manual mark ───────────────────────────────────────────────────────
export const adminManualMark = async (req, res) => {
  try {
    const { userId, date, status, checkIn, checkOut } = req.body;
    if (!userId || !date) {
      return res.status(400).json({ message: "userId and date are required" });
    }
    const record = await Attendance.findOneAndUpdate(
      { userId, date },
      { status: status || "present", checkIn, checkOut, markedAt: new Date() },
      { upsert: true, new: true },
    );
    res.json({ message: "Attendance updated", data: record });
  } catch (err) {
    console.error("adminManualMark:", err);
    res.status(500).json({ message: "Server error" });
  }
};
