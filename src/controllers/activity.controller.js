import fs from "fs";
import path from "path";
import { google } from "googleapis";
import Activity from "../models/Activity.model.js";
import CallLog from "../models/CallLog.model.js";
import Lead from "../models/Lead.model.js";
import Settings from "../models/Settings.model.js";
import User from "../models/User.model.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { formatPaginatedResponse, parsePagination } from "../utils/paginate.js";
import logger from "../utils/logger.js";

const makeOAuth2Client = () =>
  new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );

const getUserId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if (value._id) return String(value._id);
    if (value.id) return String(value.id);
    const stringValue = value.toString?.();
    return stringValue && !stringValue.startsWith("[object") ? stringValue : "";
  }
  return String(value);
};

const getUserGcalClient = async (userId) => {
  const user = await User.findById(userId).select(
    "+gcalTokens.access_token +gcalTokens.refresh_token +gcalTokens.expiry_date +gcalTokens.token_type +gcalTokens.scope",
  );
  if (!user?.gcalTokens?.access_token) {
    return null;
  }

  const client = makeOAuth2Client();
  client.setCredentials({
    access_token: user.gcalTokens.access_token,
    refresh_token: user.gcalTokens.refresh_token,
    expiry_date: user.gcalTokens.expiry_date,
    token_type: user.gcalTokens.token_type,
    scope: user.gcalTokens.scope,
  });

  client.on("tokens", async (tokens) => {
    const patch = {
      "gcalTokens.access_token": tokens.access_token,
      "gcalTokens.expiry_date": tokens.expiry_date,
    };
    if (tokens.refresh_token)
      patch["gcalTokens.refresh_token"] = tokens.refresh_token;
    await User.findByIdAndUpdate(userId, { $set: patch });
  });

  return client;
};

const formatCallLogForActivity = (callLog) => {
  const durationSeconds = Number(callLog?.duration || 0);
  const ringSeconds = Number(callLog?.ringDuration || 0);
  const durationLabel =
    durationSeconds > 0
      ? `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`
      : "0s";

  return {
    _id: callLog._id,
    leadId: callLog.lead,
    type: "Call",
    source: "call_log",
    text: callLog.phoneNumber
      ? `Call with ${callLog.phoneNumber}`
      : "Auto-tracked call",
    createdBy: callLog.user || null,
    createdByName: callLog.user?.name || null,
    organization: callLog.organization,
    callDuration: durationLabel,
    callDirection: callLog.callType || "Outgoing",
    callOutcome: callLog.recordingUploaded ? "Recorded" : "Unknown",
    recordingUrl: callLog.recordingUrl || null,
    recordingUploaded: Boolean(callLog.recordingUploaded),
    phoneNumber: callLog.phoneNumber,
    duration: durationSeconds,
    ringDuration: ringSeconds,
    callType: callLog.callType,
    callTimestamp: callLog.callTimestamp,
    createdAt: callLog.callTimestamp || callLog.createdAt,
    updatedAt: callLog.updatedAt || callLog.callTimestamp || callLog.createdAt,
    isAutoTracked: true,
  };
};

const buildTaskGcalResource = async (activity, lead) => {
  const settings = await Settings.findOne({
    organization: activity.organization,
  });
  const timezone = settings?.timezone || "Asia/Kolkata";
  if (!activity.taskDueDate) return null;

  const dueDate = new Date(activity.taskDueDate);
  if (Number.isNaN(dueDate.getTime())) return null;

  const startDateTime = dueDate;
  const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);

  const eventTitle = `Task: ${activity.text || lead?.name || "Lead task"}`;
  const description = [
    lead ? `Lead: ${lead.name}` : "",
    lead?.phone ? `Phone: ${lead.phone}` : "",
    activity.text ? `Task: ${activity.text}` : "",
    activity.taskAssignedTo
      ? `Assigned to: ${getUserId(activity.taskAssignedTo)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    summary: eventTitle,
    description,
    start: { dateTime: startDateTime.toISOString(), timeZone: timezone },
    end: { dateTime: endDateTime.toISOString(), timeZone: timezone },
    reminders: {
      useDefault: false,
      overrides: [
        { method: "popup", minutes: 30 },
        { method: "email", minutes: 60 },
      ],
    },
    extendedProperties: {
      private: {
        taskId: activity._id.toString(),
        leadId: lead?._id?.toString() || "",
      },
    },
  };
};

const createTaskGcalEvent = async (activity, lead, ownerIdOverride = null) => {
  try {
    const ownerId =
      ownerIdOverride ||
      getUserId(activity.taskAssignedTo || activity.createdBy);
    if (!ownerId) return null;
    const client = await getUserGcalClient(ownerId);
    if (!client) return null;

    const resource = await buildTaskGcalResource(activity, lead);
    if (!resource) return null;

    const calendar = google.calendar({ version: "v3", auth: client });
    const { data } = await calendar.events.insert({
      calendarId: "primary",
      resource,
    });

    logger.info(`GCal event created for task ${activity._id}: ${data.id}`);
    return data.id;
  } catch (err) {
    logger.warn(
      `GCal task event creation failed (${activity._id}): ${err.message}`,
    );
    return null;
  }
};

const updateTaskGcalEvent = async (
  activity,
  lead,
  ownerIdOverride = null,
  eventIdOverride = null,
) => {
  const eventId = eventIdOverride || activity.gcalEventId;
  if (!eventId) return null;

  try {
    const ownerId =
      ownerIdOverride ||
      getUserId(activity.taskAssignedTo || activity.createdBy);
    if (!ownerId) return null;
    const client = await getUserGcalClient(ownerId);
    if (!client) return null;

    const resource = await buildTaskGcalResource(activity, lead);
    if (!resource) return null;

    const calendar = google.calendar({ version: "v3", auth: client });
    const { data } = await calendar.events.update({
      calendarId: activity.gcalCalendarId || "primary",
      eventId,
      resource,
    });

    logger.info(`GCal event updated for task ${activity._id}: ${data.id}`);
    return data.id;
  } catch (err) {
    if (err?.code === 404 || err?.response?.status === 404) return "not_found";
    logger.warn(
      `GCal task event update failed (${activity._id}): ${err.message}`,
    );
    return null;
  }
};

export const deleteTaskGcalEvent = async (
  activity,
  ownerIdOverride = null,
  eventIdOverride = null,
) => {
  const eventId = eventIdOverride || activity?.gcalEventId;
  if (!activity || !eventId) return false;

  try {
    const ownerId =
      ownerIdOverride ||
      getUserId(activity.taskAssignedTo || activity.createdBy);
    if (!ownerId) return false;
    const client = await getUserGcalClient(ownerId);
    if (!client) return false;

    const calendar = google.calendar({ version: "v3", auth: client });
    await calendar.events.delete({
      calendarId: activity.gcalCalendarId || "primary",
      eventId,
    });

    logger.info(`GCal event deleted for task ${activity._id}: ${eventId}`);
    return true;
  } catch (err) {
    if (err?.code === 404 || err?.response?.status === 404) return true;
    logger.warn(
      `GCal task event delete failed (${activity._id}): ${err.message}`,
    );
    return false;
  }
};

export const syncTaskToGoogleCalendars = async (
  activity,
  lead,
  previousAssignedTo = null,
) => {
  if (!activity || activity.type !== "Task") return null;

  try {
    const currentOwnerId = getUserId(
      activity.taskAssignedTo || activity.createdBy,
    );
    const previousOwnerId = getUserId(previousAssignedTo);
    let existingEventId = activity.gcalEventId || "";

    if (activity.taskCompleted || !activity.taskDueDate) {
      if (existingEventId) {
        await deleteTaskGcalEvent(
          activity,
          previousOwnerId || currentOwnerId,
          existingEventId,
        );
        await Activity.findByIdAndUpdate(activity._id, {
          $set: {
            gcalEventId: "",
            gcalSyncedUser: null,
          },
        });
        activity.gcalEventId = "";
        activity.gcalSyncedUser = null;
      }
      return null;
    }

    if (
      existingEventId &&
      previousOwnerId &&
      currentOwnerId &&
      previousOwnerId !== currentOwnerId
    ) {
      await deleteTaskGcalEvent(activity, previousOwnerId, existingEventId);
      existingEventId = "";
      activity.gcalEventId = "";
    }

    if (existingEventId) {
      const updatedId = await updateTaskGcalEvent(
        activity,
        lead,
        currentOwnerId,
        existingEventId,
      );
      if (updatedId && updatedId !== "not_found") {
        await Activity.findByIdAndUpdate(activity._id, {
          $set: {
            gcalEventId: updatedId,
            gcalCalendarId: activity.gcalCalendarId || "primary",
            gcalSyncedUser: currentOwnerId || null,
          },
        });
        activity.gcalEventId = updatedId;
        return updatedId;
      }
      if (updatedId !== "not_found") return null;
    }

    const createdId = await createTaskGcalEvent(activity, lead, currentOwnerId);
    if (createdId) {
      await Activity.findByIdAndUpdate(activity._id, {
        $set: {
          gcalEventId: createdId,
          gcalCalendarId: "primary",
          gcalSyncedUser: currentOwnerId || null,
        },
      });
      activity.gcalEventId = createdId;
      activity.gcalCalendarId = "primary";
      activity.gcalSyncedUser = currentOwnerId || null;
    }
    return createdId;
  } catch (err) {
    logger.warn(`GCal task sync failed (${activity._id}): ${err.message}`);
    return null;
  }
};

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
  const { page, limit, leadId, type, assignedTo, status } = req.query;
  const organization = req.user.organization;

  const filter = { organization };
  if (leadId) filter.leadId = leadId;
  if (type) filter.type = type;
  if (assignedTo) filter.taskAssignedTo = assignedTo;
  if (type === "Task") {
    if (status === "pending") filter.taskCompleted = false;
    if (status === "completed") filter.taskCompleted = true;
  }

  const manualActivitiesQuery = Activity.find(filter)
    .populate("createdBy", "name email")
    .populate("taskAssignedTo", "name email")
    .populate("leadId", "name phone")
    .sort({ createdAt: -1 })
    .lean();

  const manualActivities = await manualActivitiesQuery;

  let combinedActivities = [...manualActivities];

  if ((!type || type === "Call") && leadId) {
    const callLogs = await CallLog.find({
      organization,
      lead: leadId,
    })
      .sort({ callTimestamp: -1 })
      .lean();

    combinedActivities = [
      ...manualActivities,
      ...callLogs.map(formatCallLogForActivity),
    ];
  }

  combinedActivities.sort((a, b) => {
    const dateA = new Date(
      b.updatedAt || b.createdAt || b.callTimestamp || 0,
    ).getTime();
    const dateB = new Date(
      a.updatedAt || a.createdAt || a.callTimestamp || 0,
    ).getTime();
    return dateA - dateB;
  });

  if (limit === undefined || String(limit).trim() === "") {
    const total = combinedActivities.length;

    logger.info(`Fetched ${combinedActivities.length} activities for user`);

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          combinedActivities,
          "Activities fetched successfully",
        ),
      );
    return;
  }

  const {
    skip,
    limit: pageLimit,
    page: pageNum,
  } = parsePagination({ page, limit }, 5000);

  const total = combinedActivities.length;
  const paginatedActivities = combinedActivities.slice(skip, skip + pageLimit);

  logger.info(`Fetched ${paginatedActivities.length} activities for user`);

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        formatPaginatedResponse(paginatedActivities, total, pageNum, pageLimit),
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
    .populate("taskAssignedTo", "name email")
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
  await activity.populate("taskAssignedTo", "name email");

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

  if (activity.type === "Task") {
    await syncTaskToGoogleCalendars(activity, lead);
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

  // Only creator, assigned task owner, or admin/master can edit
  const isCreator = activity.createdBy.equals(userId);
  const isTaskAssignee =
    activity.type === "Task" &&
    activity.taskAssignedTo &&
    activity.taskAssignedTo.equals(userId);
  const isAdmin = req.user.role === "admin" || req.user.role === "master";

  if (!isCreator && !isTaskAssignee && !isAdmin) {
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
    taskAssignedTo: activity.taskAssignedTo
      ? activity.taskAssignedTo.toString()
      : null,
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
  await activity.populate("taskAssignedTo", "name email");

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

  if (activity.type === "Task") {
    const lead = await Lead.findOne({
      _id: activity.leadId,
      organization,
    }).lean();
    await syncTaskToGoogleCalendars(activity, lead, oldActivity.taskAssignedTo);
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
    const callLog = await CallLog.findOne({ _id: id, organization });
    if (!callLog) {
      throw new ApiError(404, "Activity not found");
    }

    const isAdmin = req.user.role === "admin" || req.user.role === "master";
    const isOwner = callLog.user && String(callLog.user) === String(userId);

    if (!isAdmin && !isOwner) {
      throw new ApiError(403, "Not authorized to delete this call log");
    }

    if (callLog.recordingUrl) {
      try {
        const relativePath = callLog.recordingUrl.replace(/^\/+/, "");
        const absolutePath = path.join(process.cwd(), "src", relativePath);
        if (fs.existsSync(absolutePath)) {
          fs.unlinkSync(absolutePath);
        }
      } catch (error) {
        logger.warn(
          `Failed to delete call recording file ${callLog.recordingUrl}: ${error.message}`,
        );
      }
    }

    await CallLog.findByIdAndDelete(id);

    logger.info(`Call log deleted: ${id}`);

    return res
      .status(200)
      .json(new ApiResponse(200, null, "Call log deleted successfully"));
  }

  const isTaskAssignee =
    activity.type === "Task" &&
    activity.taskAssignedTo &&
    activity.taskAssignedTo.equals(userId);
  const isAdmin = req.user.role === "admin" || req.user.role === "master";

  // Only creator, assigned task owner, or admin/master can delete
  if (!activity.createdBy.equals(userId) && !isTaskAssignee && !isAdmin) {
    throw new ApiError(403, "Not authorized to delete this activity");
  }

  if (activity.type === "Task" && activity.gcalEventId) {
    await deleteTaskGcalEvent(activity);
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
  const organization = req.user.organization;

  const lead = await Lead.findOne({ _id: leadId, organization });
  if (!lead) throw new ApiError(404, "Lead not found");

  const activities = await Activity.find({ leadId, organization })
    .populate("createdBy", "name email")
    .populate("taskAssignedTo", "name email")
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  const callLogs = await CallLog.find({
    organization,
    lead: leadId,
  })
    .populate("user", "name email")
    .sort({ callTimestamp: -1 })
    .lean();

  const combined = [
    ...activities,
    ...callLogs.map(formatCallLogForActivity),
  ].sort(
    (a, b) =>
      new Date(b.updatedAt || b.createdAt || b.callTimestamp) -
      new Date(a.updatedAt || a.createdAt || a.callTimestamp),
  );

  res
    .status(200)
    .json(
      new ApiResponse(200, combined, "Lead activities fetched successfully"),
    );
});
