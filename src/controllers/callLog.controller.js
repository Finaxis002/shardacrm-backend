import CallLog from "../models/CallLog.model.js";
import Lead from "../models/Lead.model.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import logger from "../utils/logger.js";

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
      await CallLog.findOneAndUpdate(
        { user: userId, deviceCallId: deviceCallId || undefined },
        {
          organization,
          lead: lead?._id || null,
          user: userId,
          phoneNumber,
          callType,
          duration: duration || 0,
          callTimestamp: new Date(callTimestamp),
          deviceCallId: deviceCallId || undefined,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
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
  const { userId, startDate, endDate, page = 1, limit = 50 } = req.query;
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

  const logs = await CallLog.find(filter)
    .populate("user", "name email")
    .populate("lead", "name phone")
    .sort({ callTimestamp: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));

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
});