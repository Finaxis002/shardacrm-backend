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
import settingsRoutes from "./routes/settings.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import gcalRouter from "./routes/googleCalendar.routes.js";
import distributionRuleRoutes from "./routes/distributionRule.routes.js";
import googleSheetsRoutes from "./routes/googleSheets.routes.js";
import noteRoutes from "./routes/note.routes.js";
import taskRoutes from "./routes/task.routes.js";
import attendanceRoutes from "./routes/attendance.routes.js";
const app = express();

// Security middleware
app.use(helmet());
app.use(mongoSanitize());

// CORS
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Cookie parser
app.use(cookieParser());

// Body parser
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
app.use("/api/v1/settings", settingsRoutes);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/gcal", gcalRouter);
app.use("/api/v1/distribution-rules", distributionRuleRoutes);
app.use("/api/v1/notes", noteRoutes);
app.use("/api/v1/tasks", taskRoutes);
app.use("/api/v1/attendance", attendanceRoutes);
app.use("/api/v1/google-sheets", googleSheetsRoutes);
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
