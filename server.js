import http from "http";
import app from "./src/app.js";
import connectDB from "./src/config/db.js";
import { config } from "./src/config/env.js";
import logger from "./src/utils/logger.js";
import { startSheetPoller } from "./jobs/sheetPoller.job.js"; // 👈 ADD
import { Server } from "socket.io";         
import { getBaileysStatus } from "./src/services/whatsapp.baileys.service.js";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { startRecordingCleanupCron } from "./jobs/deleteOldRecordings.job.js";

const server = http.createServer(app);

// ⬇️ YE POORA BLOCK NAYA ADD KARO
const io = new Server(server, {
  cors: {
    origin: config.clientUrl || "*",
    credentials: true,
  },
});

app.set("io", io);          // ⬅️ NAYI LINE

io.on("connection", (socket) => {
  logger.info(`Socket connected: ${socket.id}`);

  socket.on("join-lead-room", (leadId) => {
    socket.join(`lead_${leadId}`);
  });

  socket.on("join-user-room", (userId) => {
    socket.join(`user_${userId}`);

    const { isConnected, currentQR } = getBaileysStatus(userId);
    if (isConnected) {
      socket.emit("wa-connected");
    } else if (currentQR) {
      socket.emit("wa-qr", currentQR);
    }
  });

  socket.on("disconnect", () => {
    logger.info(`Socket disconnected: ${socket.id}`);
  });
});
// ⬆️ ADD KARNA KHATAM
const PORT = config.port;

// Connect to database, phir poller start karo
connectDB().then(() => {                    // 👈 CHANGE
  startSheetPoller();                       // 👈 ADD
   startRecordingCleanupCron();  
});

server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} in ${config.nodeEnv} mode`);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  logger.error(`Unhandled Rejection: ${err.message}`);
  process.exit(1);
});

// Handle SIGTERM
process.on("SIGTERM", () => {
  logger.info("SIGTERM received. Shutting down gracefully...");
  server.close(() => {
    logger.info("Process terminated");
  });
});
