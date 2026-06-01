import Activity from "../models/Activity.model.js";
import Lead from "../models/Lead.model.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { formatPaginatedResponse, parsePagination } from "../utils/paginate.js";
import logger from "../utils/logger.js";

// ── NEW: Smart activity notification ──
import {
  sendActivityNotification,
  detectActivityChange,
} from "../utils/leadNotification.utils.js";

/**
 * Get activities (filtered by lead or all)
 * @route GET /api/v1/activities
 * @access Private
 */
export const getActivities = asyncHandler(async (req, res) => {
  const { page, limit, leadId, type } = req.query;
  const organization = req.user.organization;

  const filter = { organization };
  if (leadId) filter.leadId = leadId;
  if (type) filter.type = type;

  const {
    skip,
    limit: pageLimit,
    page: pageNum,
  } = parsePagination({ page, limit });

  const activities = await Activity.find(filter)
    .skip(skip)
    .limit(pageLimit)
    .populate("createdBy", "name email")
    .populate("leadId", "name phone")
    .sort({ createdAt: -1 })
    .lean();

  const total = await Activity.countDocuments(filter);

  logger.info(`Fetched ${activities.length} activities for user`);

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        formatPaginatedResponse(activities, total, pageNum, pageLimit),
        "Activities fetched successfully",
      ),
    );
});

/**
 * Get single activity
 * @route GET /api/v1/activities/:id
 * @access Private
 */
export const getActivity = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const organization = req.user.organization;

  const activity = await Activity.findOne({ _id: id, organization })
    .populate("createdBy", "name email")
    .populate("leadId", "name phone email")
    .lean();

  if (!activity) {
    throw new ApiError(404, "Activity not found");
  }

  res
    .status(200)
    .json(new ApiResponse(200, activity, "Activity fetched successfully"));
});

/**
 * Create activity (log call, note, email, meeting, task)
 * @route POST /api/v1/activities
 * @access Private
 */
export const createActivity = asyncHandler(async (req, res) => {
  const {
    leadId,
    type,
    text,
    callDuration,
    callDirection,
    callOutcome,
    recordingUrl,
    taskDueDate,
    taskAssignedTo,
    notifiedUsers,
  } = req.body;

  const organization = req.user.organization;
  const createdBy = req.user._id;

  // Lead validate karo
  const lead = await Lead.findOne({ _id: leadId, organization });
  if (!lead) {
    throw new ApiError(404, "Lead not found");
  }

  const activity = new Activity({
    leadId,
    type,
    text: text || "",
    createdBy,
    organization,
    callDuration,
    callDirection,
    callOutcome,
    recordingUrl,
    taskDueDate,
    taskAssignedTo,
    notifiedUsers: Array.isArray(notifiedUsers)
      ? notifiedUsers.filter(Boolean)
      : notifiedUsers
        ? [notifiedUsers]
        : [],
  });

  await activity.save();
  await activity.populate("createdBy", "name email");

  // ── Smart activity created notification ──
  // Sirf in types ke liye notification - Recording aur Payment alag handle hota hai
  const notifiableTypes = ["Note", "Call", "Email", "Meeting", "Task"];
  if (notifiableTypes.includes(type)) {
    await sendActivityNotification({
      lead,
      activity,
      userId: createdBy,
      userName: req.user.name,
      organization,
      isUpdate: false,
    });
  }

  logger.info(`Activity created: ${activity._id} for lead ${leadId}`);

  res
    .status(201)
    .json(new ApiResponse(201, activity, "Activity logged successfully"));
});

/**
 * Update activity
 * @route PUT /api/v1/activities/:id
 * @access Private
 */
export const updateActivity = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const organization = req.user.organization;
  const userId = req.user._id;

  const activity = await Activity.findOne({ _id: id, organization });
  if (!activity) {
    throw new ApiError(404, "Activity not found");
  }

  // Only creator or admin can edit
  if (!activity.createdBy.equals(userId) && req.user.role !== "admin") {
    throw new ApiError(403, "Not authorized to update this activity");
  }

  // ── Old values save karo comparison ke liye ──
  const oldActivity = {
    text: activity.text,
    notifiedUsers: activity.notifiedUsers,
    callDuration: activity.callDuration,
    callDirection: activity.callDirection,
    callOutcome: activity.callOutcome,
    taskDueDate: activity.taskDueDate,
    taskAssignedTo: activity.taskAssignedTo,
  };

  const activityType = activity.type;

  // ── Change detect karo ──
  const incomingData = {
    text: req.body.text ?? activity.text,
    notifiedUsers: req.body.notifiedUsers ?? activity.notifiedUsers,
    callDuration: req.body.callDuration ?? activity.callDuration,
    callDirection: req.body.callDirection ?? activity.callDirection,
    callOutcome: req.body.callOutcome ?? activity.callOutcome,
    taskDueDate: req.body.taskDueDate ?? activity.taskDueDate,
    taskAssignedTo: req.body.taskAssignedTo ?? activity.taskAssignedTo,
  };

  const hasChanged = detectActivityChange(
    oldActivity,
    incomingData,
    activityType,
  );

  // Update karo
  Object.assign(activity, req.body);
  await activity.save();
  await activity.populate("createdBy", "name email");

  // ── Smart activity updated notification ──
  // Sirf tab jab actual change hua ho
  const notifiableTypes = ["Note", "Call", "Email", "Meeting", "Task"];
  if (hasChanged && notifiableTypes.includes(activityType)) {
    // Lead load karo
    const lead = await Lead.findOne({
      _id: activity.leadId,
      organization,
    }).lean();

    if (lead) {
      await sendActivityNotification({
        lead,
        activity,
        userId,
        userName: req.user.name,
        organization,
        isUpdate: true,
      });
    }
  } else if (!hasChanged) {
    logger.info(`Activity ${id} unchanged, skipping notification`);
  }

  logger.info(`Activity updated: ${id}`);

  res
    .status(200)
    .json(new ApiResponse(200, activity, "Activity updated successfully"));
});

/**
 * Delete activity
 * @route DELETE /api/v1/activities/:id
 * @access Private
 */
export const deleteActivity = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const organization = req.user.organization;
  const userId = req.user._id;

  const activity = await Activity.findOne({ _id: id, organization });
  if (!activity) {
    throw new ApiError(404, "Activity not found");
  }

  // Only creator or admin can delete
  if (!activity.createdBy.equals(userId) && req.user.role !== "admin") {
    throw new ApiError(403, "Not authorized to delete this activity");
  }

  await Activity.findByIdAndDelete(id);

  logger.info(`Activity deleted: ${id}`);

  res
    .status(200)
    .json(new ApiResponse(200, null, "Activity deleted successfully"));
});

/**
 * Get activities for specific lead
 * @route GET /api/v1/activities/lead/:leadId
 * @access Private
 */
export const getLeadActivities = asyncHandler(async (req, res) => {
  const { leadId } = req.params;
  const { page, limit } = req.query;
  const organization = req.user.organization;

  const lead = await Lead.findOne({ _id: leadId, organization });
  if (!lead) {
    throw new ApiError(404, "Lead not found");
  }

const activities = await Activity.find({ leadId, organization })
  .populate("createdBy", "name email")
  .sort({ updatedAt: -1, createdAt: -1 })
  .lean();

const total = activities.length;

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        activities,
        "Lead activities fetched successfully",
      ),
    );
});
