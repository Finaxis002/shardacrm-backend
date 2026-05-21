import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import asyncHandler from "../utils/asyncHandler.js";
import ApiResponse from "../utils/apiResponse.js";
import ApiError from "../utils/apiError.js";
import Lead from "../models/Lead.model.js";
import Activity from "../models/Activity.model.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "..", "uploads", "recordings");
    console.log("Upload dir:", uploadDir);
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});

export const uploadRecordingMiddleware = multer({
  storage,
  fileFilter: (req, file, cb) => {
    /audio|video/.test(file.mimetype) ? cb(null, true) : cb(new Error("Only audio/video allowed"), false);
  },
  limits: { fileSize: 100 * 1024 * 1024 },
}).single("recording");

export const uploadRecordingFile = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const organization = req.user.organization;

  if (!req.file) throw new ApiError(400, "No file uploaded");

  const lead = await Lead.findOne({ _id: id, organization });
  if (!lead) {
    fs.unlink(req.file.path, () => {});
    throw new ApiError(404, "Lead not found");
  }

  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
  const fileUrl = `${baseUrl}/uploads/recordings/${req.file.filename}`;
  const label = req.body.label || req.file.originalname.replace(/\.[^/.]+$/, "");

  const newRecording = {
    label,
    url: fileUrl,
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    uploadedAt: new Date(),
    uploadedBy: req.user._id,
  };

  lead.recordings = lead.recordings || [];
  lead.recordings.push(newRecording);
  lead.recording = { label, url: fileUrl };
  await lead.save();

  await Activity.create({
    leadId: lead._id,
    type: "Recording",
    text: label || "Recording uploaded",
    recordingUrl: fileUrl,
    createdBy: req.user._id,
    organization,
  });

  res.status(200).json(new ApiResponse(200, { recording: newRecording }, "Recording uploaded successfully"));
});

export const deleteRecording = asyncHandler(async (req, res) => {
  const { id, filename } = req.params;
  const organization = req.user.organization;

  const lead = await Lead.findOne({ _id: id, organization });
  if (!lead) throw new ApiError(404, "Lead not found");

  await Lead.findByIdAndUpdate(
    lead._id,
    { $pull: { recordings: { filename } } },
    { new: true }
  );

  const filePath = path.join(__dirname, "uploads", "recordings", filename);
  fs.unlink(filePath, () => {});

  res.status(200).json(new ApiResponse(200, null, "Recording deleted"));
});