import Attendance from "../models/Attendance.model.js";
import User from "../models/User.model.js";
import nodemailer from "nodemailer";
import crypto from "crypto";

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
  service: "gmail",
  auth: {
    user: "adityajaysawal27@gmail.com",
    pass: "raav cneg dfzd ttfg",
  },
});

// ─── OTP: Request ─────────────────────────────────────────────────────────────
export const requestAttendanceOtp = async (req, res) => {
  try {
    const userId = req.user._id;
    const today = dateStr();

    // Already marked today?
    const existing = await Attendance.findOne({ userId, date: today });
    if (existing) {
      return res.status(409).json({ message: "Attendance already marked for today" });
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
      from: `"Attendance System" <adityajaysawal27@gmail.com>`,
      to: "adityajaysawal27@gmail.com",
      subject: `🕐 Attendance Approval Request — ${req.user.name || req.user.email} · ${today}`,
      html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Attendance OTP</title></head>
<body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:480px;margin:auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">

    <!-- Header -->
    <div style="background:#1a1f3a;padding:28px 32px 24px">
      <p style="color:rgba(255,255,255,0.7);font-size:13px;font-weight:500;margin:0 0 14px;letter-spacing:0.04em">&#128336; Attendance System</p>
      <h1 style="color:#fff;font-size:22px;font-weight:600;margin:0 0 6px">Attendance Approval</h1>
      <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:0">A new check-in request is awaiting your approval</p>
    </div>

    <!-- Body -->
    <div style="padding:28px 32px">

      <!-- Employee -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0">
        <tr>
          <td width="52" style="padding:14px 0 14px 16px;vertical-align:middle">
            <div style="width:36px;height:36px;border-radius:8px;background:#e8edfe;text-align:center;line-height:36px;font-size:16px;color:#5a7bf6;font-weight:700">E</div>
          </td>
          <td style="padding:14px 16px 14px 8px;vertical-align:middle">
            <div style="font-size:10px;color:#94a3b8;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:3px">Employee</div>
            <div style="font-size:14px;color:#1a2050;font-weight:600">${req.user.name || req.user.email}</div>
          </td>
        </tr>
      </table>

      <!-- Date -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0">
        <tr>
          <td width="52" style="padding:14px 0 14px 16px;vertical-align:middle">
            <div style="width:36px;height:36px;border-radius:8px;background:#dcfce7;text-align:center;line-height:36px;font-size:16px;color:#16a34a;font-weight:700">D</div>
          </td>
          <td style="padding:14px 16px 14px 8px;vertical-align:middle">
            <div style="font-size:10px;color:#94a3b8;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:3px">Date</div>
            <div style="font-size:14px;color:#1a2050;font-weight:600">${today}</div>
          </td>
        </tr>
      </table>

      <!-- OTP Box -->
      <div style="background:#1a1f3a;border-radius:12px;padding:24px 20px;text-align:center;margin-bottom:20px">
        <div style="font-size:10px;color:rgba(255,255,255,0.4);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:16px">One-time password</div>
        <table cellpadding="0" cellspacing="0" style="margin:0 auto 14px">
          <tr>
            ${otp.split('').map(d => `
            <td style="padding:0 4px">
              <div style="width:44px;height:52px;background:rgba(255,255,255,0.08);border-radius:8px;border:1px solid rgba(255,255,255,0.15);text-align:center;line-height:52px;font-size:26px;font-weight:700;color:#fff">${d}</div>
            </td>`).join('')}
          </tr>
        </table>
        <div style="color:rgba(255,255,255,0.4);font-size:12px">&#9201; Expires in <strong style="color:rgba(255,255,255,0.65)">5 minutes</strong></div>
      </div>

      <!-- Warning -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px">
        <tr>
          <td width="36" style="padding:12px 0 12px 14px;vertical-align:top;font-size:14px;color:#d97706">&#9888;</td>
          <td style="padding:12px 12px 12px 6px;font-size:12px;color:#64748b;line-height:1.6">
            Share this OTP <strong style="color:#1a2050">only with the employee</strong> if you approve their attendance. Do not share if the request seems unauthorised.
          </td>
        </tr>
      </table>

    </div>

    <!-- Footer -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e2e8f0">
      <tr>
        <td style="padding:14px 32px;font-size:11px;color:#94a3b8">Attendance System &middot; Auto-generated</td>
        <td style="padding:14px 32px;text-align:right">
          <span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;background:#dcfce7;color:#16a34a;border:1px solid #bbf7d0">SECURE OTP</span>
        </td>
      </tr>
    </table>

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
      return res.status(400).json({ message: "No OTP found. Please request a new one." });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(userId.toString());
      return res.status(400).json({ message: "OTP has expired. Please request a new one." });
    }

    if (record.otp !== otp.trim()) {
      return res.status(400).json({ message: "Invalid OTP. Please try again." });
    }

    // OTP valid — delete it immediately (one-time use)
    otpStore.delete(userId.toString());

    const today = dateStr();

    // Double-check not already marked (race condition guard)
    const existing = await Attendance.findOne({ userId, date: today });
    if (existing) {
      return res.status(409).json({ message: "Attendance already marked for today" });
    }

    const attendance = await Attendance.create({
      userId,
      date: today,
      checkIn: timeStr(),
      status: "present",
    });

    res.status(201).json({ message: "Attendance marked successfully", data: attendance });
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
      return res.status(409).json({ message: "Attendance already marked for today" });
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
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    const records = await Attendance.find({
      userId,
      date: { $regex: `^${prefix}` },
    }).lean();
    const byDate = {};
    records.forEach((r) => { byDate[r.date] = r; });
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
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
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
    }).select("name email phone role").lean();
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
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    const user = await User.findById(userId).select("name email phone role").lean();
    if (!user) return res.status(404).json({ message: "User not found" });
    const records = await Attendance.find({
      userId,
      date: { $regex: `^${prefix}` },
    }).lean();
    const byDate = {};
    records.forEach((r) => { byDate[r.date] = r; });
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
        { name:  { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }
    const users = await User.find(filter).select("name email phone role").lean();
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
      { upsert: true, new: true }
    );
    res.json({ message: "Attendance updated", data: record });
  } catch (err) {
    console.error("adminManualMark:", err);
    res.status(500).json({ message: "Server error" });
  }
};