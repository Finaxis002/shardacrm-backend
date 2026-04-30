import Activity from "../models/Activity.model.js";
import Lead from "../models/Lead.model.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { formatPaginatedResponse, parsePagination } from "../utils/paginate.js";
import logger from "../utils/logger.js";

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
  } = parsePagination({
    page,
    limit,
  });

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
  } = req.body;

  const organization = req.user.organization;
  const createdBy = req.user._id;

  // Validate lead exists
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
  });

  await activity.save();
  await activity.populate("createdBy", "name email");

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

  // Only creator can edit
  if (!activity.createdBy.equals(userId) && req.user.role !== "admin") {
    throw new ApiError(403, "Not authorized to update this activity");
  }

  Object.assign(activity, req.body);
  await activity.save();
  await activity.populate("createdBy", "name email");

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

  // Validate lead exists
  const lead = await Lead.findOne({ _id: leadId, organization });
  if (!lead) {
    throw new ApiError(404, "Lead not found");
  }

  const {
    skip,
    limit: pageLimit,
    page: pageNum,
  } = parsePagination({
    page,
    limit,
  });

  const activities = await Activity.find({ leadId, organization })
    .skip(skip)
    .limit(pageLimit)
    .populate("createdBy", "name email")
    .sort({ createdAt: -1 })
    .lean();

  const total = await Activity.countDocuments({ leadId, organization });

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        formatPaginatedResponse(activities, total, pageNum, pageLimit),
        "Lead activities fetched successfully",
      ),
    );
});
