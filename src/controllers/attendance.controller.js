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
// { "userId_checkIn" | "userId_checkOut": { otp, expiresAt } }
const otpStore = new Map();

// ─── Nodemailer transporter ───────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: config.attendance.email,
    pass: config.attendance.pass,
  },
});

// ─── OTP: Request (checkIn or checkOut) ───────────────────────────────────────
export const requestAttendanceOtp = async (req, res) => {
  try {
    const userId = req.user._id;
    const today = dateStr();

    // type can be "checkIn" (default) or "checkOut"
    const type = req.body.type === "checkOut" ? "checkOut" : "checkIn";

    const existing = await Attendance.findOne({ userId, date: today });

    if (type === "checkIn") {
      // Already checked in today?
      if (existing) {
        return res
          .status(409)
          .json({ message: "Attendance already marked for today" });
      }
    } else {
      // checkOut: must have checked in first
      if (!existing) {
        return res
          .status(400)
          .json({ message: "You have not checked in today yet" });
      }
      // Already checked out?
      if (existing.checkOut) {
        return res
          .status(409)
          .json({ message: "Check-out already recorded for today" });
      }
    }

    // Find any active admin
    const admin = await User.findOne({ role: "admin", isActive: true }).lean();
    if (!admin) return res.status(404).json({ message: "No admin found" });

    // Generate 6-digit OTP
    const otp = crypto.randomInt(100000, 999999).toString();

    // Store with 5-minute expiry, keyed by userId + type
    const storeKey = `${userId.toString()}_${type}`;
    otpStore.set(storeKey, {
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    const actionLabel = type === "checkIn" ? "Check-In" : "Check-Out";
    const actionEmoji = type === "checkIn" ? "🟢" : "🔴";

    // Send email to admin
    await transporter.sendMail({
      from: `"Attendance System" <${config.attendance.email}>`,
      to: config.attendance.email,
      subject: `${actionEmoji} ${actionLabel} Request — ${req.user.name || req.user.email} · ${today}`,
      html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <title>Attendance OTP</title>
  <style>
    @media only screen and (max-width:600px){
      .wrapper { padding: 12px 8px !important; }
      .card    { border-radius: 12px !important; }
      .header  { padding: 20px 16px 16px !important; }
      .body    { padding: 16px 16px 0 !important; }
      .info-table { display:block !important; }
      .info-td    { display:block !important; width:100% !important; box-sizing:border-box !important; margin-bottom:10px !important; }
      .otp-box    { padding: 20px 10px !important; }
      .otp-digit  { width:36px !important; height:44px !important; line-height:44px !important; font-size:22px !important; }
      .otp-gap    { padding:0 2px !important; }
      .footer     { padding: 12px 16px !important; flex-direction:column !important; gap:6px !important; }
      .h1         { font-size:17px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div class="wrapper" style="padding:24px 12px">
<div class="card" style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:0.5px solid #E2E8F0">

  <!-- Accent bar -->
  <div style="height:4px;background:${type === "checkIn" ? "linear-gradient(90deg,#4F46E5,#6366F1,#818CF8)" : "linear-gradient(90deg,#DC2626,#EF4444,#F87171)"}"></div>

  <!-- Header -->
  <div class="header" style="padding:24px 24px 20px;border-bottom:1px solid #F1F5F9">
    <table cellpadding="0" cellspacing="0" width="100%"><tr>
      <td width="42">
        <div style="width:36px;height:36px;border-radius:8px;background:${type === "checkIn" ? "#EEF2FF" : "#FEF2F2"};text-align:center;line-height:36px;font-size:18px">${actionEmoji}</div>
      </td>
      <td style="vertical-align:middle;padding-left:8px">
        <span style="font-size:12px;color:#64748B;font-weight:500;letter-spacing:0.02em">Attendance System</span>
      </td>
    </tr></table>
    <h1 class="h1" style="font-size:18px;font-weight:700;color:#0F172A;margin:14px 0 4px">
      ${actionLabel} Request
    </h1>
    <p style="font-size:13px;color:#64748B;margin:0;line-height:1.5">
      A ${actionLabel.toLowerCase()} request is awaiting your approval.
    </p>
  </div>

  <!-- Info cards — stack on mobile -->
  <div class="body" style="padding:20px 24px 0">
    <table class="info-table" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:20px">
      <tr>
        <td class="info-td" width="48%" style="background:#F8FAFC;border-radius:10px;border:0.5px solid #E2E8F0;padding:12px 14px;vertical-align:top">
          <div style="font-size:10px;color:#94A3B8;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;margin-bottom:7px">Employee</div>
          <table cellpadding="0" cellspacing="0"><tr>
            <td width="28">
              <div style="width:24px;height:24px;border-radius:50%;background:${type === "checkIn" ? "#EEF2FF" : "#FEF2F2"};text-align:center;line-height:24px;font-size:11px;font-weight:700;color:${type === "checkIn" ? "#4F46E5" : "#DC2626"}">${(req.user.name || req.user.email || "?")[0].toUpperCase()}</div>
            </td>
            <td style="padding-left:7px;font-size:14px;color:#0F172A;font-weight:600">${req.user.name || req.user.email}</td>
          </tr></table>
        </td>
        <td width="4%"></td>
        <td class="info-td" width="48%" style="background:#F8FAFC;border-radius:10px;border:0.5px solid #E2E8F0;padding:12px 14px;vertical-align:top">
          <div style="font-size:10px;color:#94A3B8;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;margin-bottom:7px">Date</div>
          <div style="font-size:14px;color:#0F172A;font-weight:600">${new Date(today).toLocaleDateString("en-IN",{day:"numeric",month:"long",year:"numeric",timeZone:"Asia/Kolkata"})}</div>
          <div style="font-size:11px;color:${type === "checkIn" ? "#4F46E5" : "#DC2626"};font-weight:600;margin-top:4px">${actionEmoji} ${actionLabel}</div>
        </td>
      </tr>
    </table>

    <!-- OTP Box -->
    <div class="otp-box" style="border:0.5px solid ${type === "checkIn" ? "#C7D2FE" : "#FECACA"};border-radius:14px;padding:24px 16px;margin-bottom:16px;text-align:center;background:${type === "checkIn" ? "#FAFAFE" : "#FFF5F5"}">
      <div style="font-size:10px;color:${type === "checkIn" ? "#6366F1" : "#EF4444"};font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:16px">
        One-Time Password
      </div>
      <!-- OTP digits — single centered row -->
      <div style="display:table;margin:0 auto 16px">
        <div style="display:table-row">
          ${otp.split("").map((d) => `<div class="otp-gap" style="display:table-cell;padding:0 3px"><div class="otp-digit" style="width:40px;height:48px;background:${type === "checkIn" ? "#EEF2FF" : "#FEF2F2"};border:1.5px solid ${type === "checkIn" ? "#C7D2FE" : "#FECACA"};border-radius:10px;text-align:center;line-height:48px;font-size:24px;font-weight:700;color:${type === "checkIn" ? "#3730A3" : "#991B1B"}">${d}</div></div>`).join("")}
        </div>
      </div>
      <div style="display:inline-block;background:#FFF7ED;border:0.5px solid #FED7AA;border-radius:20px;padding:5px 14px;font-size:12px;color:#EA580C;font-weight:500">
        ⏱ Expires in <strong>5 minutes</strong>
      </div>
    </div>

    <!-- Warning -->
    <table cellpadding="0" cellspacing="0" width="100%" style="background:#FFFBEB;border:0.5px solid #FCD34D;border-radius:10px;margin-bottom:20px">
      <tr>
        <td width="36" style="padding:12px 0 12px 14px;vertical-align:top;font-size:15px">⚠️</td>
        <td style="padding:12px 14px 12px 6px;font-size:12px;color:#64748B;line-height:1.7">
          Share this OTP <strong style="color:#0F172A">only with the employee</strong> after verifying the request is legitimate.
        </td>
      </tr>
    </table>
  </div>

  <!-- Footer -->
  <table class="footer" cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid #F1F5F9;padding:12px 24px">
    <tr>
      <td style="font-size:11px;color:#94A3B8">Attendance System · Auto-generated · Do not reply</td>
      <td align="right" style="white-space:nowrap">
        <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:#ECFDF5;color:#065F46;border:0.5px solid #A7F3D0">SECURE</span>
      </td>
    </tr>
  </table>

</div>
</div>
</body>
</html>
`,
    });

    res.json({ message: `OTP sent to admin email for ${actionLabel}` });
  } catch (err) {
    console.error("requestAttendanceOtp:", err);
    res.status(500).json({ message: "Failed to send OTP. Please try again." });
  }
};

// ─── OTP: Verify & Mark (checkIn or checkOut) ─────────────────────────────────
export const verifyAttendanceOtp = async (req, res) => {
  try {
    const userId = req.user._id;
    const { otp, type: rawType } = req.body;
    const type = rawType === "checkOut" ? "checkOut" : "checkIn";

    if (!otp) return res.status(400).json({ message: "OTP is required" });

    const storeKey = `${userId.toString()}_${type}`;
    const record = otpStore.get(storeKey);

    if (!record) {
      return res
        .status(400)
        .json({ message: "No OTP found. Please request a new one." });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(storeKey);
      return res
        .status(400)
        .json({ message: "OTP has expired. Please request a new one." });
    }

    if (record.otp !== otp.trim()) {
      return res
        .status(400)
        .json({ message: "Invalid OTP. Please try again." });
    }

    // OTP valid — delete it (one-time use)
    otpStore.delete(storeKey);

    const today = dateStr();

    if (type === "checkIn") {
      // Race condition guard
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

      return res.status(201).json({
        message: "Check-in marked successfully",
        data: attendance,
      });
    } else {
      // checkOut
      const attendance = await Attendance.findOneAndUpdate(
        { userId, date: today },
        { checkOut: timeStr() },
        { new: true }
      );

      if (!attendance) {
        return res
          .status(400)
          .json({ message: "No check-in found for today" });
      }

      return res.status(200).json({
        message: "Check-out marked successfully",
        data: attendance,
      });
    }
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

// ─── Admin: Monthly export (full detail — names per day) ─────────────────────
export const adminMonthlyExport = async (req, res) => {
  try {
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const prefix = `${year}-${String(month).padStart(2, "0")}`;

    // All active users
    const allUsers = await User.find({ isActive: true })
      .select("name email")
      .lean();

    // All present records for the month, with user info
    const records = await Attendance.find({ date: { $regex: `^${prefix}` } })
      .populate("userId", "name email")
      .lean();

    // Group records by date
    const byDate = {};
    records.forEach((r) => {
      if (!r.userId) return;
      if (!byDate[r.date]) byDate[r.date] = [];
      byDate[r.date].push(r);
    });

    res.json({ month, year, allUsers, byDate });
  } catch (err) {
    console.error("adminMonthlyExport:", err);
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
      { upsert: true, new: true }
    );
    res.json({ message: "Attendance updated", data: record });
  } catch (err) {
    console.error("adminManualMark:", err);
    res.status(500).json({ message: "Server error" });
  }
};  