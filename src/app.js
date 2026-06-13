import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import mongoSanitize from "express-mongo-sanitize";
import { corsOptions } from "./config/corsOptions.js";
import errorHandler from "./middleware/errorHandler.js";
import authRoutes from "./routes/auth.routes.js";
import leadRoutes from "./routes/lead.routes.js";
import activityRoutes from "./routes/activity.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import reminderRoutes from "./routes/reminder.routes.js";
import userRoutes from "./routes/user.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import pushRoutes from "./routes/push.routes.js";
import settingsRoutes from "./routes/settings.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import gcalRouter from "./routes/googleCalendar.routes.js";
import distributionRuleRoutes from "./routes/distributionRule.routes.js";
import googleSheetsRoutes from "./routes/googleSheets.routes.js";
import attendanceRoutes from "./routes/attendance.routes.js";
import eventRouter from "./routes/event.routes.js";
import integrationRoutes from "./routes/Integration.routes.js";
import logoutOtpRoutes from "./routes/Logoutotp.route.js";
import metaWebhookRoutes from "./routes/metaWebhook.routes.js";
import { fileURLToPath } from "url";
import path from "path";
import crossSellRouter from "./routes/Crosssell.routes.js";
import whatsappRouter from "./routes/whatsapp.routes.js";
import callLogRoutes from "./routes/callLog.routes.js";
import startEmailScheduler from "./utils/emailScheduler.js";
import { startReactivationCron } from "./cron/reactivationCron.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
startEmailScheduler();
startReactivationCron();
// Security middleware
app.use(helmet());
app.use(mongoSanitize());

// CORS
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Cookie parser
app.use(cookieParser());

// ─── Razorpay Webhook (express.json) ───────────────
app.use(
  "/api/v1/payments/razorpay/webhook",
  express.raw({ type: "application/json" }),
  (req, res, next) => {
    req.rawBody = req.body.toString();
    next();
  },
);

// WhatsApp webhook raw body parser for signature verification
app.use(
  "/api/v1/whatsapp/webhook",
  express.raw({ type: "application/json" }),
  (req, res, next) => {
    req.rawBody = req.body;
    next();
  },
);

// Body parser (webhook ke BAAD)
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ limit: "16kb", extended: true }));

// Health check
app.get("/api/v1/health", (req, res) => {
  res.status(200).json({ status: "OK", timestamp: new Date() });
});

// API Routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/leads", leadRoutes);
app.use("/api/v1/activities", activityRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/reminders", reminderRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/push", pushRoutes);
app.use("/api/v1/settings", settingsRoutes);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/gcal", gcalRouter);
app.use("/api/v1/distribution-rules", distributionRuleRoutes);
app.use("/api/v1/attendance", attendanceRoutes);
app.use("/api/v1/google-sheets", googleSheetsRoutes);
app.use("/api/v1/events", eventRouter);
app.use("/api/v1/integrations", integrationRoutes);
app.use("/api/v1/auth", logoutOtpRoutes);
app.use("/api/v1/cross-sell", crossSellRouter);
app.use("/api/v1/whatsapp", whatsappRouter);
app.use(
  "/uploads/recordings",
  (req, res, next) => {
    res.header("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  },
  express.static(path.join(process.cwd(), "src", "uploads", "recordings")),
);

// ── Call Log routes + recording file serving ──
app.use("/api/v1/call-logs", callLogRoutes);
app.use(
  "/uploads/call-recordings",
  (req, res, next) => {
    res.header("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  },
  express.static(path.join(process.cwd(), "src", "uploads", "call-recordings")),
);
// New Live Test Route  
app.get("/api/v1/test-live", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Sharda CRM Backend is working flawlessly on Oracle Cloud!",
    timestamp: new Date(),
  });
});
app.use("/api/v1/meta", metaWebhookRoutes);
// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Error handling middleware
app.use(errorHandler);

export default app;
