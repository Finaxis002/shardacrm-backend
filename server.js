import http from "http";
import app from "./src/app.js";
import connectDB from "./src/config/db.js";
import { config } from "./src/config/env.js";
import logger from "./src/utils/logger.js";

const server = http.createServer(app);

// Connect to database
connectDB();

const PORT = config.port;

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
