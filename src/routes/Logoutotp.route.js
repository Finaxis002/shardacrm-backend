import express from "express";
import nodemailer from "nodemailer";
import crypto from "crypto";

const router = express.Router();

// ─── In-memory OTP store ──────────────────────────────────────────────────────
// { [userId]: { otp, expiresAt, attempts } }
const otpStore = new Map();

const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 3;

// ─── Nodemailer transporter ───────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.ATTENDANCE_EMAIL,
    pass: process.env.ATTENDANCE_EMAIL_PASS,
  },
});

// ─── Helper: 6-digit OTP ─────────────────────────────────────────────────────
function generateOtp() {
  return String(crypto.randomInt(100000, 999999));
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/auth/send-logout-otp
// Body: { userId }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/send-logout-otp", async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required." });
    }

    // Fetch user details for the email
    const { default: User } = await import("../models/User.model.js");
    const user = await User.findById(userId).select("name email role");

    const ADMIN_OTP_EMAIL = "bdefinaxis@gmail.com";

    const otp = generateOtp();
    otpStore.set(String(userId), {
      otp,
      expiresAt: Date.now() + OTP_EXPIRY_MS,
      attempts: 0,
    });

    const roleLabel = {
      admin: "Admin",
      manager: "Manager",
      tl: "Team Leader",
      exec: "Executive",
      viewer: "Viewer",
    }[user?.role] || user?.role || "Unknown";

    const now = new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    });

    await transporter.sendMail({
      from: `"Sharda CRM" <${process.env.ATTENDANCE_EMAIL}>`,
      to: ADMIN_OTP_EMAIL,
      subject: `Logout OTP Request – ${user?.name || "Unknown User"} | Sharda CRM`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f5f3ff;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #ede9fe;">

          <!-- Purple Header -->
          <tr>
            <td style="background:#534ab7;padding:30px 40px;text-align:center;">
              <p style="margin:0 0 6px;color:rgba(255,255,255,0.55);font-size:11px;text-transform:uppercase;letter-spacing:2px;font-weight:600;">Sharda CRM</p>
              <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">Confirm your logout</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 40px 24px;">

              <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.7;">
                A logout request has been initiated. Use the OTP below to complete the process.
              </p>

              <!-- User details table -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
                    <p style="margin:0 0 3px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.8px;">Name</p>
                    <p style="margin:0;font-size:14px;font-weight:600;color:#1e293b;">${user?.name || "Unknown"}</p>
                  </td>
                  <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
                    <p style="margin:0 0 3px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.8px;">Role</p>
                    <p style="margin:0;font-size:14px;font-weight:600;color:#1e293b;">${roleLabel}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;" colspan="2">
                    <p style="margin:0 0 3px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.8px;">Email</p>
                    <p style="margin:0;font-size:14px;font-weight:600;color:#1e293b;">${user?.email || "—"}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0;" colspan="2">
                    <p style="margin:0 0 3px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.8px;">Time of request</p>
                    <p style="margin:0;font-size:14px;font-weight:600;color:#1e293b;">${now} (IST)</p>
                  </td>
                </tr>
              </table>

              <!-- OTP Box -->
              <p style="margin:0 0 10px;font-size:11px;color:#7f77dd;text-align:center;text-transform:uppercase;letter-spacing:1.2px;font-weight:600;">Your OTP</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                <tr>
                  <td style="background:#eeedfe;border:1.5px solid #afa9ec;border-radius:12px;padding:22px;text-align:center;">
                    <span style="font-size:42px;font-weight:700;letter-spacing:14px;color:#3c3489;">${otp}</span>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">
                Valid for <strong style="color:#534ab7;">5 minutes</strong> &nbsp;&middot;&nbsp; Single use only &nbsp;&middot;&nbsp; Do not share
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#faf9ff;border-top:1px solid #ede9fe;padding:18px 40px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.7;">
                If you did not initiate this request, contact your administrator immediately.<br/>
                &copy; ${new Date().getFullYear()} Sharda CRM &nbsp;&middot;&nbsp; All rights reserved
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `,
    });

    return res.json({ success: true, message: "OTP sent to your email." });

  } catch (error) {
    console.error("[send-logout-otp] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to send OTP." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/auth/verify-logout-otp
// Body: { userId, otp }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/verify-logout-otp", (req, res) => {
  try {
    const { userId, otp } = req.body;

    if (!userId || !otp) {
      return res.status(400).json({ success: false, message: "userId and otp are required." });
    }

    const record = otpStore.get(String(userId));

    if (!record) {
      return res.status(400).json({
        success: false,
        message: "OTP not found. Please request a new one.",
      });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(String(userId));
      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please request a new one.",
      });
    }

    if (record.attempts >= MAX_ATTEMPTS) {
      otpStore.delete(String(userId));
      return res.status(429).json({
        success: false,
        message: "Too many wrong attempts. Please request a new OTP.",
      });
    }

    if (record.otp !== String(otp)) {
      record.attempts += 1;
      otpStore.set(String(userId), record);
      return res.status(400).json({
        success: false,
        message: `Invalid OTP. ${MAX_ATTEMPTS - record.attempts} attempt(s) remaining.`,
      });
    }

    otpStore.delete(String(userId));
    return res.json({ success: true });

  } catch (error) {
    console.error("[verify-logout-otp] Error:", error);
    return res.status(500).json({ success: false, message: "Verification failed." });
  }
});

export default router;