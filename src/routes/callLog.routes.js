import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { protect } from "../middleware/auth.middleware.js";
import {
  syncCallLogs,
  getCallLogsForLead,
  getAllCallLogs,
  uploadRecording,
  uploadCallLogWithRecording,
  getCallStatsByUser,
} from "../controllers/callLog.controller.js";

const router = express.Router();

const uploadDir = path.join(process.cwd(), "src", "uploads", "call-recordings");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".m4a";
    const rawNumber = String(req.body?.phoneNumber || "call");
    const cleanNumber = rawNumber.replace(/\D/g, "").slice(-10) || "call";
    cb(null, `${cleanNumber}-${Date.now()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

router.post("/", protect, syncCallLogs);
router.post(
  "/sync-with-recording",
  protect,
  upload.single("recording"),
  uploadCallLogWithRecording,
);
router.get("/", protect, getCallLogsForLead);
router.get("/all", protect, getAllCallLogs);
router.get("/stats", protect, getCallStatsByUser);
router.post(
  "/:id/recording",
  protect,
  upload.single("recording"),
  uploadRecording,
);

export default router;
