import Lead from "../models/Lead.model.js";
import User from "../models/User.model.js";
import Activity from "../models/Activity.model.js";
import Payment from "../models/Payment.model.js";
import Reminder from "../models/Reminder.model.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { formatPaginatedResponse, parsePagination } from "../utils/paginate.js";
import logger from "../utils/logger.js";

/**
 * Get all leads with filters and pagination
 * @route GET /api/v1/leads
 * @access Private
 */
export const getLeads = asyncHandler(async (req, res) => {
  const { page, limit, status, source, assignedTo, search } = req.query;
  const userId = req.user._id;
  const organization = req.user.organization;

  // Build filter
  const filter = { organization };
  if (status) filter.status = status;
  if (source) filter.source = source;
  if (assignedTo) filter.assignedTo = assignedTo;

  // Search in name, email, or phone
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
    ];
  }

  const {
    skip,
    limit: pageLimit,
    page: pageNum,
  } = parsePagination({
    page,
    limit,
  });

  const leads = await Lead.find(filter)
    .skip(skip)
    .limit(pageLimit)
    .populate("assignedTo", "name email")
    .populate("coAssignees", "name email")
    .lean();

  const total = await Lead.countDocuments(filter);

  logger.info(`Fetched ${leads.length} leads for user ${userId}`);

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        formatPaginatedResponse(leads, total, pageNum, pageLimit),
        "Leads fetched successfully",
      ),
    );
});

/**
 * Get single lead by ID
 * @route GET /api/v1/leads/:id
 * @access Private
 */
export const getLead = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const organization = req.user.organization;

  const lead = await Lead.findOne({ _id: id, organization })
    .populate("assignedTo", "name email phone")
    .populate("coAssignees", "name email phone")
    .lean();

  if (!lead) {
    throw new ApiError(404, "Lead not found");
  }

  res.status(200).json(new ApiResponse(200, lead, "Lead fetched successfully"));
});

/**
 * Create new lead
 * @route POST /api/v1/leads
 * @access Private
 */
export const createLead = asyncHandler(async (req, res) => {
  const {
    name,
    phone,
    email,
    city,
    source,
    status = "New",
    dealValue,
    product,
    closeDate,
    priority,
    note,
    assignedTo,
    coAssignees = [],
    activity,
    recording,
    payment,
    reminder,
    customFields,
  } = req.body;

  const organization = req.user.organization;
  const createdBy = req.user._id;
  const assignedUserId = assignedTo || createdBy;

  // Check if lead with same phone already exists in organization
  const existingLead = await Lead.findOne({ phone, organization });
  if (existingLead) {
    throw new ApiError(400, "Lead with this phone number already exists");
  }

  // Validate assignedTo user exists
  const assignedUser = await User.findOne({ _id: assignedUserId, organization });
  if (!assignedUser) {
    throw new ApiError(400, "Assigned user not found in organization");
  }

  const productValue = Array.isArray(product) ? product.join(", ") : product || "";

  const lead = new Lead({
    name,
    phone,
    email,
    city,
    source: source || "Other",
    status,
    dealValue,
    product: productValue,
    closeDate,
    priority: priority || "Normal",
    assignedTo: assignedUserId,
    coAssignees,
    organization,
    createdBy,
    customFields: customFields || {},
  });

  await lead.save();
  await lead.populate("assignedTo", "name email");

  const activityPromises = [];
  if (note) {
    activityPromises.push(
      Activity.create({
        leadId: lead._id,
        type: "Note",
        text: note,
        createdBy: req.user._id,
        organization,
      }),
    );
  } else {
    activityPromises.push(
      Activity.create({
        leadId: lead._id,
        type: "Note",
        text: `Lead created by ${req.user.name}`,
        createdBy: req.user._id,
        organization,
      }),
    );
  }

  if (activity && activity.type) {
    const activityData = {
      leadId: lead._id,
      type: activity.type,
      text: activity.text || "",
      createdBy: req.user._id,
      organization,
      notifiedUsers: activity.notifiedUsers || [],
    };

    if (activity.type === "Call") {
      activityData.callDuration = activity.callDuration;
      activityData.callDirection = activity.callDirection;
      activityData.callOutcome = activity.callOutcome;
    }
    if (activity.type === "Task") {
      activityData.taskDueDate = activity.taskDueDate;
      activityData.taskAssignedTo = activity.taskAssignedTo;
      activityData.taskCompleted = false;
    }

    activityPromises.push(Activity.create(activityData));
  }

  if (recording && (recording.label || recording.url)) {
    activityPromises.push(
      Activity.create({
        leadId: lead._id,
        type: "Recording",
        text: recording.label || "Recording uploaded",
        recordingUrl: recording.url,
        createdBy: req.user._id,
        organization,
      }),
    );
  }

  if (payment && payment.amount !== undefined) {
    const paymentItem = new Payment({
      leadId: lead._id,
      amount: payment.amount,
      currency: "INR",
      paymentMode: payment.paymentMode,
      status: payment.status || "Paid",
      reference: payment.reference,
      paymentDate: payment.paymentDate || new Date(),
      recordedBy: req.user._id,
      organization,
    });
    activityPromises.push(paymentItem.save());
  }

  if (reminder && reminder.reminderDate) {
    const reminderItem = new Reminder({
      leadId: lead._id,
      type: reminder.type,
      assignedTo: reminder.assignedTo,
      reminderDate: reminder.reminderDate,
      reminderTime: reminder.reminderTime,
      note: reminder.note,
      notifyUsers: reminder.notifyUsers || [],
      organization,
    });
    activityPromises.push(reminderItem.save());
  }

  await Promise.all(activityPromises);

  logger.info(`Lead created: ${lead._id} by user ${createdBy}`);

  res.status(201).json(new ApiResponse(201, lead, "Lead created successfully"));
});

/**
 * Update lead
 * @route PUT /api/v1/leads/:id
 * @access Private
 */
export const updateLead = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const organization = req.user.organization;
  const userId = req.user._id;

  const lead = await Lead.findOne({ _id: id, organization });
  if (!lead) {
    throw new ApiError(404, "Lead not found");
  }

  const canEditAny =
    req.user.role === "admin" ||
    (req.user.permissions && req.user.permissions.includes("edit_any_lead"));
  const isAssignee = lead.assignedTo && lead.assignedTo.equals(userId);
  const isCoAssignee = lead.coAssignees.some((user) => user.equals(userId));
  if (!canEditAny && !isAssignee && !isCoAssignee) {
    throw new ApiError(403, "Not authorized to update this lead");
  }

  const oldStatus = lead.status;
  const oldAssignee = lead.assignedTo && lead.assignedTo.toString();

  const allowedFields = [
    "name",
    "phone",
    "email",
    "city",
    "source",
    "status",
    "dealValue",
    "product",
    "closeDate",
    "priority",
    "customFields",
  ];

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      lead[field] = req.body[field];
    }
  });

  if (req.body.assignedTo !== undefined) {
    const hasAssignPermission =
      req.user.role === "admin" ||
      (req.user.permissions && req.user.permissions.includes("assign_leads"));

    if (!hasAssignPermission) {
      throw new ApiError(403, "Not authorized to reassign this lead");
    }

    const assignee = await User.findOne({ _id: req.body.assignedTo, organization });
    if (!assignee) {
      throw new ApiError(400, "Assigned user not found in organization");
    }

    lead.assignedTo = req.body.assignedTo;
  }

  if (req.body.product !== undefined) {
    lead.product = Array.isArray(req.body.product)
      ? req.body.product.join(", ")
      : req.body.product;
  }

  await lead.save();
  await lead.populate("assignedTo", "name email");

  if (oldStatus !== lead.status) {
    await Activity.create({
      leadId: lead._id,
      type: "note",
      text: `Status changed from ${oldStatus} to ${lead.status}`,
      statusFrom: oldStatus,
      statusTo: lead.status,
      createdBy: userId,
      organization,
    });
  }

  if (req.body.assignedTo !== undefined && oldAssignee !== String(req.body.assignedTo)) {
    const newUser = await User.findOne({ _id: req.body.assignedTo, organization });
    const previousName = oldAssignee
      ? (await User.findById(oldAssignee))?.name
      : "Unassigned";

    await Activity.create({
      leadId: lead._id,
      type: "note",
      text: `Lead reassigned from ${previousName} to ${newUser?.name || "Unknown"}`,
      createdBy: userId,
      organization,
    });
  }

  logger.info(`Lead updated: ${id} by user ${userId}`);

  res.status(200).json(new ApiResponse(200, lead, "Lead updated successfully"));
});

/**
 * Delete lead
 * @route DELETE /api/v1/leads/:id
 * @access Private
 */
export const deleteLead = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const organization = req.user.organization;

  // Check permission - only admin or lead owner can delete
  const lead = await Lead.findOne({ _id: id, organization });
  if (!lead) {
    throw new ApiError(404, "Lead not found");
  }

  if (req.user.role !== "admin" && !lead.assignedTo.equals(req.user._id)) {
    throw new ApiError(403, "Not authorized to delete this lead");
  }

  await Lead.findByIdAndDelete(id);

  // Delete related activities
  await Activity.deleteMany({ leadId: id });

  logger.info(`Lead deleted: ${id} by user ${req.user._id}`);

  res.status(200).json(new ApiResponse(200, null, "Lead deleted successfully"));
});

/**
 * Update lead status
 * @route PATCH /api/v1/leads/:id/status
 * @access Private
 */
export const updateLeadStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const organization = req.user.organization;
  const userId = req.user._id;

  const lead = await Lead.findOne({ _id: id, organization });
  if (!lead) {
    throw new ApiError(404, "Lead not found");
  }

  const oldStatus = lead.status;
  lead.status = status;
  await lead.save();

  // Log activity
  await Activity.create({
    leadId: lead._id,
    type: "note",
    text: `Status changed from ${oldStatus} to ${status} by ${req.user.name}`,
    statusFrom: oldStatus,
    statusTo: status,
    createdBy: userId,
    organization,
  });

  logger.info(`Lead status updated: ${id} to ${status}`);

  res
    .status(200)
    .json(new ApiResponse(200, lead, "Lead status updated successfully"));
});

/**
 * Assign lead to user
 * @route PATCH /api/v1/leads/:id/assign
 * @access Private
 */
export const assignLead = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { assignedTo } = req.body;
  const organization = req.user.organization;
  const userId = req.user._id;

  const lead = await Lead.findOne({ _id: id, organization });
  if (!lead) {
    throw new ApiError(404, "Lead not found");
  }

  // Validate user exists
  const user = await User.findOne({ _id: assignedTo, organization });
  if (!user) {
    throw new ApiError(400, "User not found in organization");
  }

  const previousAssignee = lead.assignedTo;
  lead.assignedTo = assignedTo;
  await lead.save();
  await lead.populate("assignedTo", "name email");

  // Log activity
  const previousName = previousAssignee
    ? (await User.findById(previousAssignee))?.name
    : "Unassigned";
  await Activity.create({
    leadId: lead._id,
    type: "note",
    text: `Lead reassigned from ${previousName} to ${user.name}`,
    createdBy: userId,
    organization,
  });

  logger.info(`Lead reassigned: ${id} to ${assignedTo}`);

  res
    .status(200)
    .json(new ApiResponse(200, lead, "Lead assigned successfully"));
});

/**
 * Add co-assignee to lead
 * @route POST /api/v1/leads/:id/co-assignees
 * @access Private
 */
export const addCoAssignee = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { userId } = req.body;
  const organization = req.user.organization;

  const lead = await Lead.findOne({ _id: id, organization });
  if (!lead) {
    throw new ApiError(404, "Lead not found");
  }

  // Check if user exists
  const user = await User.findOne({ _id: userId, organization });
  if (!user) {
    throw new ApiError(400, "User not found in organization");
  }

  // Check if already co-assigned
  if (lead.coAssignees.includes(userId)) {
    throw new ApiError(400, "User is already a co-assignee");
  }

  lead.coAssignees.push(userId);
  await lead.save();
  await lead.populate("coAssignees", "name email");

  logger.info(`Co-assignee added to lead ${id}`);

  res
    .status(200)
    .json(new ApiResponse(200, lead, "Co-assignee added successfully"));
});

/**
 * Remove co-assignee from lead
 * @route DELETE /api/v1/leads/:id/co-assignees/:userId
 * @access Private
 */
export const removeCoAssignee = asyncHandler(async (req, res) => {
  const { id, userId } = req.params;
  const organization = req.user.organization;

  const lead = await Lead.findOne({ _id: id, organization });
  if (!lead) {
    throw new ApiError(404, "Lead not found");
  }

  lead.coAssignees = lead.coAssignees.filter((uid) => !uid.equals(userId));
  await lead.save();
  await lead.populate("coAssignees", "name email");

  logger.info(`Co-assignee removed from lead ${id}`);

  res
    .status(200)
    .json(new ApiResponse(200, lead, "Co-assignee removed successfully"));
});

/**
 * Get lead statistics
 * @route GET /api/v1/leads/stats/overview
 * @access Private
 */
export const getLeadStats = asyncHandler(async (req, res) => {
  const organization = req.user.organization;

  const stats = await Lead.aggregate([
    { $match: { organization } },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        totalValue: { $sum: "$dealValue" },
      },
    },
  ]);

  const totalLeads = await Lead.countDocuments({ organization });
  const totalValue = await Lead.aggregate([
    { $match: { organization } },
    { $group: { _id: null, total: { $sum: "$dealValue" } } },
  ]);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        total: totalLeads,
        totalValue: totalValue[0]?.total || 0,
        byStatus: stats,
      },
      "Lead statistics fetched successfully",
    ),
  );
});
