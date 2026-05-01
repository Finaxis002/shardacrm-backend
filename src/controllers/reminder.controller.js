import Reminder from "../models/Reminder.model.js";
import Lead from "../models/Lead.model.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { formatPaginatedResponse, parsePagination } from "../utils/paginate.js";
import logger from "../utils/logger.js";

/**
 * Get all reminders
 * @route GET /api/v1/reminders
 * @access Private
 */
export const getReminders = asyncHandler(async (req, res) => {
  const { page, limit, leadId, status } = req.query;
  const organization = req.user.organization;

  let filter = { organization };

  if (leadId) filter.leadId = leadId;
  if (status === "pending") filter.isDone = false;
  if (status === "completed") filter.isDone = true;

  const { skip, limit: pageLimit, page: pageNum } = parsePagination({ page, limit });

  const reminders = await Reminder.find(filter)
    .skip(skip)
    .limit(pageLimit)
    .populate("leadId", "name phone email")
    .populate("assignedTo", "name email")
    .populate("doneBy", "name email")
    .sort({ reminderDate: 1 })
    .lean();

  const total = await Reminder.countDocuments(filter);

  res.status(200).json(
    new ApiResponse(200, formatPaginatedResponse(reminders, total, pageNum, pageLimit), "Reminders fetched successfully"),
  );
});

/**
 * Get single reminder
 * @route GET /api/v1/reminders/:id
 * @access Private
 */
export const getReminder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const organization = req.user.organization;

  const reminder = await Reminder.findOne({ _id: id, organization })
    .populate("leadId", "name phone email")
    .populate("assignedTo", "name email")
    .populate("doneBy", "name email")
    .lean();

  if (!reminder) {
    throw new ApiError(404, "Reminder not found");
  }

  res
    .status(200)
    .json(new ApiResponse(200, reminder, "Reminder fetched successfully"));
});

/**
 * Create reminder
 * @route POST /api/v1/reminders
 * @access Private
 */
export const createReminder = asyncHandler(async (req, res) => {
  const { leadId, type, assignedTo, reminderDate, reminderTime, note } =
    req.body;

  const organization = req.user.organization;
  const createdBy = req.user._id;

  // Validate lead exists
  const lead = await Lead.findOne({ _id: leadId, organization });
  if (!lead) {
    throw new ApiError(404, "Lead not found");
  }

  const reminder = new Reminder({
    leadId,
    type,
    assignedTo: assignedTo || createdBy,
    reminderDate,
    reminderTime,
    note,
    organization,
    notifyUsers: [assignedTo || createdBy],
  });

  await reminder.save();
  await reminder.populate("leadId", "name phone");
  await reminder.populate("assignedTo", "name email");

  logger.info(`Reminder created: ${reminder._id} for lead ${leadId}`);

  res
    .status(201)
    .json(new ApiResponse(201, reminder, "Reminder created successfully"));
});

/**
 * Update reminder
 * @route PUT /api/v1/reminders/:id
 * @access Private
 */
export const updateReminder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const organization = req.user.organization;
  const userId = req.user._id;

  const reminder = await Reminder.findOne({ _id: id, organization });
  if (!reminder) {
    throw new ApiError(404, "Reminder not found");
  }

  // Only assigned user or admin can edit
  if (!reminder.assignedTo.equals(userId) && req.user.role !== "admin") {
    throw new ApiError(403, "Not authorized to update this reminder");
  }

  Object.assign(reminder, req.body);
  await reminder.save();
  await reminder.populate("leadId", "name phone");
  await reminder.populate("assignedTo", "name email");

  logger.info(`Reminder updated: ${id}`);

  res
    .status(200)
    .json(new ApiResponse(200, reminder, "Reminder updated successfully"));
});

/**
 * Delete reminder
 * @route DELETE /api/v1/reminders/:id
 * @access Private
 */
export const deleteReminder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const organization = req.user.organization;

  const reminder = await Reminder.findOne({ _id: id, organization });
  if (!reminder) {
    throw new ApiError(404, "Reminder not found");
  }

  await Reminder.findByIdAndDelete(id);

  logger.info(`Reminder deleted: ${id}`);

  res
    .status(200)
    .json(new ApiResponse(200, null, "Reminder deleted successfully"));
});

/**
 * Mark reminder as done
 * @route PATCH /api/v1/reminders/:id/done
 * @access Private
 */
export const markReminderDone = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { isDone } = req.body;
  const organization = req.user.organization;
  const userId = req.user._id;

  const reminder = await Reminder.findOne({ _id: id, organization });
  if (!reminder) {
    throw new ApiError(404, "Reminder not found");
  }

  reminder.isDone = isDone;
  if (isDone) {
    reminder.doneAt = new Date();
    reminder.doneBy = userId;
  } else {
    reminder.doneAt = null;
    reminder.doneBy = null;
  }

  await reminder.save();
  await reminder.populate("leadId", "name phone");
  await reminder.populate("assignedTo", "name email");
  await reminder.populate("doneBy", "name email");

  logger.info(`Reminder marked ${isDone ? "done" : "pending"}: ${id}`);

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        reminder,
        `Reminder marked ${isDone ? "done" : "pending"} successfully`,
      ),
    );
});

/**
 * Get pending reminders for today
 * @route GET /api/v1/reminders/today/pending
 * @access Private
 */
export const getTodayReminders = asyncHandler(async (req, res) => {
  const organization = req.user.organization;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const reminders = await Reminder.find({
    organization,
    // ✅ assignedTo filter hata diya — organization ke saare aaj ke reminders
    isDone: false,
    reminderDate: { $gte: today, $lt: tomorrow },
  })
    .populate("leadId", "name phone email")
    .populate("assignedTo", "name email")
    .sort({ reminderTime: 1 })
    .lean();

  res.status(200).json(
    new ApiResponse(200, reminders, "Today's reminders fetched successfully"),
  );
});
