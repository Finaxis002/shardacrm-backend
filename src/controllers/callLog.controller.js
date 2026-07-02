import fs from "fs";
import path from "path";
import CallLog from "../models/CallLog.model.js";
import Lead from "../models/Lead.model.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import logger from "../utils/logger.js";
import { analyzeCallRecording } from "../services/aiCallAnalysis.service.js";

const runCallLogAiAnalysisInBackground = async (callLogId, filePath) => {
  try {
    const analysis = await analyzeCallRecording(filePath);

    await CallLog.findByIdAndUpdate(callLogId, {
      $set: {
        transcript: analysis.transcript,
        aiAnalysis: {
          summary: analysis.summary,
          intent: analysis.intent,
          redFlags: analysis.redFlags,
          objections: analysis.objections,
          nextSteps: analysis.nextSteps,
        },
      },
    });

    logger.info(`AI analysis completed for call log ${callLogId}`);
 } catch (err) {
    logger.error(`AI analysis failed for call log ${callLogId} | ${err.message} | file exists: ${require('fs').existsSync(filePath)} | path: ${filePath}`);
  }
};

export const syncCallLogs = asyncHandler(async (req, res) => {
  const { logs } = req.body;
  if (!Array.isArray(logs) || logs.length === 0) {
    throw new ApiError(400, "logs array required");
  }

  const organization = req.user.organization;
  const userId = req.user._id;

  let syncedCount = 0;

  for (const entry of logs) {
    const { phoneNumber, callType, duration, callTimestamp, deviceCallId } =
      entry;
    if (!phoneNumber || !callType || !callTimestamp) continue;

    const cleanNumber = phoneNumber.replace(/\D/g, "").slice(-10);
    const lead = await Lead.findOne({
      organization,
      $or: [
        { phone: { $regex: cleanNumber + "$" } },
        { alternatePhone: { $regex: cleanNumber + "$" } },
      ],
    }).select("_id");

    try {
      const query = deviceCallId ? { user: userId, deviceCallId } : null;
      const parsedCallTimestamp = isNaN(Number(callTimestamp))
        ? new Date(callTimestamp)
        : new Date(Number(callTimestamp));
      const callData = {
        organization,
        lead: lead?._id || null,
        user: userId,
        phoneNumber,
        callType,
        duration: duration || 0,
        callTimestamp: parsedCallTimestamp,
        ...(deviceCallId && { deviceCallId }),
      };

      if (query) {
        await CallLog.findOneAndUpdate(
          query,
          { $set: callData },
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
          },
        );
      } else {
        await CallLog.create(callData);
      }
      syncedCount++;
    } catch (err) {
      continue;
    }
  }

  logger.info(`Call logs synced: ${syncedCount} by user ${userId}`);

  res
    .status(200)
    .json(new ApiResponse(200, { synced: syncedCount }, "Call logs synced"));
});

export const uploadCallLogWithRecording = asyncHandler(async (req, res) => {
  const { phoneNumber, callType, duration, callTimestamp, deviceCallId } =
    req.body;

  if (!req.file) {
    throw new ApiError(400, "No file uploaded");
  }

  if (!phoneNumber || !callType || !callTimestamp) {
    throw new ApiError(
      400,
      "phoneNumber, callType, and callTimestamp are required",
    );
  }

  const organization = req.user.organization;
  const userId = req.user._id;

  const cleanNumber = String(phoneNumber).replace(/\D/g, "").slice(-10);
  const lead = await Lead.findOne({
    organization,
    $or: [
      { phone: { $regex: cleanNumber + "$" } },
      { alternatePhone: { $regex: cleanNumber + "$" } },
    ],
  }).select("_id");

  const relativeUrl = `/uploads/call-recordings/${req.file.filename}`;
  const parsedCallTimestamp = isNaN(Number(callTimestamp))
    ? new Date(callTimestamp)
    : new Date(Number(callTimestamp));
  const callData = {
    organization,
    lead: lead?._id || null,
    user: userId,
    phoneNumber,
    callType,
    duration: Number(duration) || 0,
    callTimestamp: parsedCallTimestamp,
    recordingUrl: relativeUrl,
    recordingUploaded: true,
    ...(deviceCallId && { deviceCallId }),
  };

  const query = deviceCallId ? { user: userId, deviceCallId } : null;
  let callLog;
  if (query) {
    callLog = await CallLog.findOneAndUpdate(
      query,
      { $set: callData },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );
  } else {
    callLog = await CallLog.create(callData);
  }

  try {
    const rawNumber = String(phoneNumber || "call");
    const safeNumber = rawNumber.replace(/\D/g, "").slice(-10) || "call";
    const ext = path.extname(req.file.filename) || ".m4a";
    const newFilename = `${safeNumber}-${callLog._id || Date.now()}${ext}`;
    const newFilePath = path.join(path.dirname(req.file.path), newFilename);

    if (req.file.path !== newFilePath) {
      fs.renameSync(req.file.path, newFilePath);
      callLog.recordingUrl = `/uploads/call-recordings/${newFilename}`;
      await callLog.save();
    }
  } catch (err) {
    logger.warn("Call recording file rename failed", err);
  }

  logger.info(`Call log uploaded with recording for user ${userId}`);

  res
    .status(200)
    .json(new ApiResponse(200, callLog, "Call log with recording uploaded"));

// Fire-and-forget — response already sent above, this runs after
  const recordingFilename = callLog.recordingUrl.split('/').pop();
  const finalPath = path.join(path.dirname(req.file.path), recordingFilename);
  logger.info(`AI queued | callLog: ${callLog._id} | path: ${finalPath}`);
  runCallLogAiAnalysisInBackground(callLog._id, finalPath);
});

export const getCallLogsForLead = asyncHandler(async (req, res) => {
  const { leadId } = req.query;
  if (!leadId) {
    throw new ApiError(400, "leadId is required");
  }

  const logs = await CallLog.find({
    organization: req.user.organization,
    lead: leadId,
  })
    .populate("user", "name email")
    .sort({ callTimestamp: -1 })
    .limit(100);

  res.status(200).json(new ApiResponse(200, logs, "Call logs fetched"));
});

export const getAllCallLogs = asyncHandler(async (req, res) => {
  const { userId, startDate, endDate, page = 1, limit } = req.query;
  const organization = req.user.organization;

  const filter = { organization };
  if (userId) filter.user = userId;
  if (startDate || endDate) {
    filter.callTimestamp = {};
    if (startDate)
      filter.callTimestamp.$gte = new Date(startDate + "T00:00:00+05:30");
    if (endDate)
      filter.callTimestamp.$lte = new Date(endDate + "T23:59:59+05:30");
  }

  // limit na diya ho toh sab records fetch karo (no pagination)
  let query = CallLog.find(filter)
    .populate("user", "name email")
    .populate("lead", "name phone")
    .sort({ callTimestamp: -1 });

  if (limit) {
    query = query.skip((page - 1) * Number(limit)).limit(Number(limit));
  }

  const logs = await query;

  // ── Fallback: jin logs ka lead null hai, unko phone number se match karo ──
  const unmatchedLogs = logs.filter((l) => !l.lead && l.phoneNumber);
  if (unmatchedLogs.length) {
    const cleanNumbers = [
      ...new Set(
        unmatchedLogs.map((l) =>
          String(l.phoneNumber).replace(/\D/g, "").slice(-10),
        ),
      ),
    ].filter(Boolean);

    if (cleanNumbers.length) {
      const regexOr = cleanNumbers.map((num) => ({
        $or: [
          { phone: { $regex: num + "$" } },
          { alternatePhone: { $regex: num + "$" } },
        ],
      }));

      const matchedLeads = await Lead.find({
        organization,
        $or: regexOr,
      })
        .select("name phone alternatePhone")
        .lean();

      // number → lead lookup map banao
      const leadByNumber = {};
      matchedLeads.forEach((ld) => {
        const p1 = String(ld.phone || "").replace(/\D/g, "").slice(-10);
        const p2 = String(ld.alternatePhone || "").replace(/\D/g, "").slice(-10);
        if (p1) leadByNumber[p1] = ld;
        if (p2) leadByNumber[p2] = ld;
      });

      unmatchedLogs.forEach((log) => {
        const clean = String(log.phoneNumber).replace(/\D/g, "").slice(-10);
        const matched = leadByNumber[clean];
        if (matched) {
          log.lead = { _id: matched._id, name: matched.name, phone: matched.phone };
        }
      });
    }
  }

  const total = await CallLog.countDocuments(filter);

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { logs, total, page: Number(page) },
        "Call logs fetched",
      ),
    );
});

export const uploadRecording = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!req.file) {
    throw new ApiError(400, "No file uploaded");
  }

  const callLog = await CallLog.findOne({
    _id: id,
    organization: req.user.organization,
  });
  if (!callLog) {
    throw new ApiError(404, "Call log not found");
  }

  const relativeUrl = `/uploads/call-recordings/${req.file.filename}`;
  callLog.recordingUrl = relativeUrl;
  callLog.recordingUploaded = true;
  await callLog.save();

  res
    .status(200)
    .json(new ApiResponse(200, callLog, "Recording uploaded successfully"));

  // Fire-and-forget — response already sent above, this runs after
  runCallLogAiAnalysisInBackground(callLog._id, req.file.path);
});
// ─── NEW: Per-user call tracing / stats ──────────────────────────────────
export const getCallStatsByUser = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const organization = req.user.organization;

  const matchStage = { organization };
  if (startDate || endDate) {
    matchStage.callTimestamp = {};
    if (startDate)
      matchStage.callTimestamp.$gte = new Date(startDate + "T00:00:00+05:30");
    if (endDate)
      matchStage.callTimestamp.$lte = new Date(endDate + "T23:59:59+05:30");
  }

  const stats = await CallLog.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: "$user",
        totalCalls: { $sum: 1 },
        outgoing: { $sum: { $cond: [{ $eq: ["$callType", "Outgoing"] }, 1, 0] } },
        incoming: { $sum: { $cond: [{ $eq: ["$callType", "Incoming"] }, 1, 0] } },
        missed: { $sum: { $cond: [{ $eq: ["$callType", "Missed"] }, 1, 0] } },
        rejected: { $sum: { $cond: [{ $eq: ["$callType", "Rejected"] }, 1, 0] } },
        totalDurationSecs: { $sum: "$duration" },
        recordedCalls: { $sum: { $cond: [{ $eq: ["$recordingUploaded", true] }, 1, 0] } },
        lastCallAt: { $max: "$callTimestamp" },
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "userInfo",
      },
    },
    { $unwind: { path: "$userInfo", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        userId: "$_id",
        _id: 0,
        userName: { $ifNull: ["$userInfo.name", "Unknown user"] },
        userEmail: "$userInfo.email",
        totalCalls: 1,
        callsMade: "$outgoing",
        answered: { $add: ["$outgoing", "$incoming"] },
        notAnswered: { $add: ["$missed", "$rejected"] },
        missed: 1,
        rejected: 1,
        totalDurationSecs: 1,
        recordedCalls: 1,
        lastCallAt: 1,
      },
    },
    { $sort: { totalCalls: -1 } },
  ]);

  res.status(200).json(new ApiResponse(200, stats, "Call stats fetched"));
});