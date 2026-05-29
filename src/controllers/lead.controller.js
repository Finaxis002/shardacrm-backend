import mongoose from "mongoose";
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
import Settings from "../models/Settings.model.js";
import { canUser } from "../utils/permissions.js";
import { google } from "googleapis";
import {
  createNotifications,
  createNotificationsWithSender,
} from "../utils/notification.utils.js";

// ── NEW: Smart notification utils import ──
import {
  buildLeadRecipients,
  buildReminderRecipients,
  formatReminderDateTime,
  sendProfileUpdateNotification,
  sendStatusChangeNotification,
  sendReassignmentNotification,
  sendActivityNotification,
  sendPaymentNotification,
  sendRecordingNotification,
  sendReminderNotification,
  detectActivityChange,
} from "../utils/leadNotification.utils.js";

/**
 * Get all leads with filters and pagination
 * @route GET /api/v1/leads
 * @access Private
 */
export const getLeads = asyncHandler(async (req, res) => {
  const {
    page,
    limit,
    status,
    source,
    assignedTo,
    search,
    priority,
    dateFrom,
    dateTo,
    dateFilterType,
  } = req.query;

  const userId = req.user._id;
  const organization = req.user.organization;
  const isAdmin = req.user.role === "admin";
  const canViewAllLeads =
    isAdmin || (await canUser(req.user, organization, "view_all_leads"));

  const queryConditions = [{ organization }];

  // Status Filter
  if (status) {
    const statusParam = String(status).trim();

    if (statusParam === "active") {
      const exclusionStatuses = ["Success", "Closed"];
      queryConditions.push({
        status: { $nin: exclusionStatuses },
      });
    } else if (statusParam.includes(",")) {
      const statuses = statusParam
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      if (statuses.length === 1) {
        queryConditions.push({ status: statuses[0] });
      } else if (statuses.length > 1) {
        queryConditions.push({ status: { $in: statuses } });
      }
    } else {
      queryConditions.push({ status: statusParam });
    }
  }

  // Source Filter
  if (source) queryConditions.push({ source });

  // Priority Filter
  if (priority) {
    queryConditions.push({ priority });
  }

  // Date Range Filter
  if (dateFrom || dateTo) {
    const dateField =
      dateFilterType === "closeDate" ? "closeDate" : "createdAt";
    const dateFilter = {};

    if (dateFrom) {
      dateFilter.$gte = new Date(dateFrom);
    }
    if (dateTo) {
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      dateFilter.$lte = endDate;
    }

    if (Object.keys(dateFilter).length > 0) {
      queryConditions.push({ [dateField]: dateFilter });
    }
  }

  // Access Control
  let accessFilter = null;
  const viewTeamOnly = await canUser(
    req.user,
    organization,
    "view_team_leads_only",
  );

  if (isAdmin) {
    if (assignedTo) {
      queryConditions.push({
        assignedTo: new mongoose.Types.ObjectId(assignedTo),
      });
    }
  } else if (req.user.role === "manager" && canViewAllLeads) {
    if (assignedTo) {
      queryConditions.push({
        assignedTo: new mongoose.Types.ObjectId(assignedTo),
      });
    }
  } else if (req.user.role === "manager" && viewTeamOnly) {
    const subordinates = await User.find({ managerId: userId, organization })
      .select("_id")
      .lean();
    const subordinateIds = subordinates.map((u) => u._id);
    const allowedIds = [userId, ...subordinateIds];

    accessFilter = {
      $or: [
        { assignedTo: { $in: allowedIds } },
        { coAssignees: { $in: allowedIds } },
      ],
    };
    queryConditions.push(accessFilter);

    if (assignedTo && allowedIds.map(String).includes(String(assignedTo))) {
      queryConditions.push({
        assignedTo: new mongoose.Types.ObjectId(assignedTo),
      });
    }
  } else if (canViewAllLeads) {
    if (assignedTo) {
      queryConditions.push({
        assignedTo: new mongoose.Types.ObjectId(assignedTo),
      });
    }
  } else {
    accessFilter = {
      $or: [{ assignedTo: userId }, { coAssignees: userId }],
    };
    queryConditions.push(accessFilter);
  }

  if (search) {
    queryConditions.push({
      $or: [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
        { alternatePhone: { $regex: search, $options: "i" } },
      ],
    });
  }

  const filter = { $and: queryConditions };

  const {
    skip,
    limit: pageLimit,
    page: pageNum,
  } = parsePagination({
    page,
    limit,
  });

  const aggregationResult = await Lead.aggregate([
    { $match: filter },
    {
      $facet: {
        metadata: [{ $count: "total" }],
        totalValue: [
          {
            $group: {
              _id: null,
              sum: {
                $sum: {
                  $convert: {
                    input: { $ifNull: ["$dealValue", "$value", 0] },
                    to: "double",
                    onError: 0,
                    onNull: 0,
                  },
                },
              },
            },
          },
        ],
        data: [
          { $sort: { updatedAt: -1 } },
          { $skip: skip },
          { $limit: pageLimit },
          {
            $lookup: {
              from: "users",
              localField: "assignedTo",
              foreignField: "_id",
              as: "assignedTo",
            },
          },
          {
            $unwind: { path: "$assignedTo", preserveNullAndEmptyArrays: true },
          },
          {
            $lookup: {
              from: "users",
              localField: "coAssignees",
              foreignField: "_id",
              as: "coAssignees",
            },
          },
          {
            $project: {
              "assignedTo.password": 0,
              "assignedTo.tokens": 0,
              "coAssignees.password": 0,
              "coAssignees.tokens": 0,
            },
          },
        ],
      },
    },
  ]).allowDiskUse(true);

  const leads = aggregationResult[0]?.data || [];
  const total = aggregationResult[0]?.metadata[0]?.total || 0;
  const totalValue = aggregationResult[0]?.totalValue[0]?.sum || 0;

  logger.info(`Fetched ${leads.length} leads for user ${userId}`);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        ...formatPaginatedResponse(leads, total, pageNum, pageLimit),
        totalValue,
      },
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
  const userId = req.user._id;
  const isAdmin = req.user.role === "admin";

  const lead = await Lead.findOne({ _id: id, organization })
    .populate("assignedTo", "name email phone")
    .populate("coAssignees", "name email phone")
    .lean();

  if (!lead) {
    throw new ApiError(404, "Lead not found");
  }

  if (!isAdmin) {
    const isAssignee =
      lead.assignedTo && lead.assignedTo._id.toString() === userId.toString();
    const isCoAssignee = lead.coAssignees?.some(
      (c) => c._id.toString() === userId.toString(),
    );
    if (!isAssignee && !isCoAssignee) {
      throw new ApiError(403, "You are not authorized to view this lead");
    }
  }

  const activities = await Activity.find({ leadId: lead._id })
    .sort({ createdAt: -1 })
    .lean();

  const payments = await Payment.find({ leadId: lead._id })
    .sort({ paymentDate: -1, createdAt: -1 })
    .lean();

  const reminders = await Reminder.find({ leadId: lead._id })
    .sort({ reminderDate: 1, reminderTime: 1 })
    .lean();

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { ...lead, activities, payments, reminders },
        "Lead fetched successfully",
      ),
    );
});

// ── Google Calendar Helpers ──────────────────────────────────────────────────

const makeOAuth2Client = () =>
  new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );

const extractId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if (value._id) return String(value._id);
    if (value.id) return String(value.id);
    const stringValue = value.toString?.();
    if (stringValue && !stringValue.startsWith("[object")) return stringValue;
    return "";
  }
  return String(value);
};

const createGcalEventForReminder = async (organization, reminderDoc, lead) => {
  try {
    const settings = await Settings.findOne({ organization });
    if (!settings?.gcalConnected || !settings?.gcalTokens?.access_token)
      return null;

    const client = makeOAuth2Client();
    client.setCredentials({
      access_token: settings.gcalTokens.access_token,
      refresh_token: settings.gcalTokens.refresh_token,
      expiry_date: settings.gcalTokens.expiry_date,
      token_type: settings.gcalTokens.token_type,
      scope: settings.gcalTokens.scope,
    });

    client.on("tokens", async (tokens) => {
      const patch = {
        "gcalTokens.access_token": tokens.access_token,
        "gcalTokens.expiry_date": tokens.expiry_date,
      };
      if (tokens.refresh_token)
        patch["gcalTokens.refresh_token"] = tokens.refresh_token;
      await Settings.findOneAndUpdate({ organization }, { $set: patch });
    });

    const timezone = settings.timezone || "Asia/Kolkata";
    const dateStr = new Date(reminderDoc.reminderDate)
      .toISOString()
      .split("T")[0];
    const timeStr = reminderDoc.reminderTime || "09:00";
    const start = new Date(`${dateStr}T${timeStr}:00`);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const calendar = google.calendar({ version: "v3", auth: client });
    const { data } = await calendar.events.insert({
      calendarId: "primary",
      resource: {
        summary: `${reminderDoc.type || "Follow-up"}: ${lead.name}`,
        description: `Lead: ${lead.name}\nPhone: ${lead.phone || "N/A"}\nType: ${reminderDoc.type || "Follow-up"}\nNote: ${reminderDoc.note || ""}`,
        start: { dateTime: start.toISOString(), timeZone: timezone },
        end: { dateTime: end.toISOString(), timeZone: timezone },
        reminders: {
          useDefault: false,
          overrides: [
            { method: "popup", minutes: 30 },
            { method: "email", minutes: 60 },
          ],
        },
        extendedProperties: {
          private: {
            reminderId: reminderDoc._id.toString(),
            leadId: lead._id.toString(),
          },
        },
      },
    });

    logger.info(
      `GCal event created for reminder ${reminderDoc._id}: ${data.id}`,
    );
    return data.id;
  } catch (err) {
    logger.warn(`GCal event creation failed: ${err.message}`);
    return null;
  }
};

const updateGcalEventForReminder = async (organization, reminderDoc, lead) => {
  if (!reminderDoc.gcalEventId) return null;
  try {
    const settings = await Settings.findOne({ organization });
    if (!settings?.gcalConnected || !settings?.gcalTokens?.access_token)
      return null;

    const client = makeOAuth2Client();
    client.setCredentials({
      access_token: settings.gcalTokens.access_token,
      refresh_token: settings.gcalTokens.refresh_token,
      expiry_date: settings.gcalTokens.expiry_date,
    });

    client.on("tokens", async (tokens) => {
      const patch = {
        "gcalTokens.access_token": tokens.access_token,
        "gcalTokens.expiry_date": tokens.expiry_date,
      };
      if (tokens.refresh_token)
        patch["gcalTokens.refresh_token"] = tokens.refresh_token;
      await Settings.findOneAndUpdate({ organization }, { $set: patch });
    });

    const timezone = settings.timezone || "Asia/Kolkata";
    const dateStr = new Date(reminderDoc.reminderDate)
      .toISOString()
      .split("T")[0];
    const timeStr = reminderDoc.reminderTime || "09:00";
    const start = new Date(`${dateStr}T${timeStr}:00`);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const calendar = google.calendar({ version: "v3", auth: client });
    const { data } = await calendar.events.update({
      calendarId: "primary",
      eventId: reminderDoc.gcalEventId,
      resource: {
        summary: `${reminderDoc.type || "Follow-up"}: ${lead.name}`,
        description: `Lead: ${lead.name}\nPhone: ${lead.phone || "N/A"}\nType: ${reminderDoc.type || "Follow-up"}\nNote: ${reminderDoc.note || ""}`,
        start: { dateTime: start.toISOString(), timeZone: timezone },
        end: { dateTime: end.toISOString(), timeZone: timezone },
        reminders: {
          useDefault: false,
          overrides: [
            { method: "popup", minutes: 30 },
            { method: "email", minutes: 60 },
          ],
        },
      },
    });

    logger.info(`GCal event updated for reminder ${reminderDoc._id}`);
    return data.id;
  } catch (err) {
    logger.warn(`GCal event update failed: ${err.message}`);
    return null;
  }
};

/**
 * Create new lead
 * @route POST /api/v1/leads
 * @access Private
 */
export const createLead = asyncHandler(async (req, res) => {
  const {
    name,
    phone,
    alternatePhone,
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
    activities,
    recording,
    payment,
    reminder,
    customFields,
  } = req.body;

  const organization = req.user.organization;
  const createdBy = req.user._id;
  const hasAssignPermission =
    req.user.role === "admin" ||
    (await canUser(req.user, organization, "assign_leads"));
  const assignedUserId =
    assignedTo || req.body.assignee || req.body.assigned_to || createdBy;

  if (
    assignedUserId &&
    String(assignedUserId) !== String(createdBy) &&
    !hasAssignPermission
  ) {
    throw new ApiError(
      403,
      "Not authorized to assign this lead to another user",
    );
  }

  if (
    Array.isArray(coAssignees) &&
    coAssignees.length > 0 &&
    !hasAssignPermission
  ) {
    throw new ApiError(403, "Not authorized to add co-assignees to this lead");
  }

  const existingLead = await Lead.findOne({
    organization,
    $or: [
      { phone: phone },
      ...(alternatePhone ? [{ alternatePhone: alternatePhone }] : []),
    ],
  });
  if (existingLead) {
    throw new ApiError(400, "Lead with this phone number already exists");
  }

  const assignedUser = await User.findOne({
    _id: assignedUserId,
    organization,
  });
  if (!assignedUser) {
    throw new ApiError(400, "Assigned user not found in organization");
  }

  const productValue = Array.isArray(product)
    ? product.join(", ")
    : product || "";

  const lead = new Lead({
    name,
    phone,
    alternatePhone,
    email,
    city,
    source: source || "Other",
    status,
    dealValue,
    product: productValue,
    closeDate,
    initialNote: note,
    priority: priority || "Normal",
    assignedTo: assignedUserId,
    coAssignees,
    organization,
    createdBy,
    customFields: customFields || {},
  });

  if (recording && (recording.label || recording.url)) {
    lead.recording = {
      label: recording.label || "",
      url: recording.url || "",
    };
  }

  await lead.save();
  await lead.populate("assignedTo", "name email");

  // ── Lead created notification ──
  // buildLeadRecipients: assignedTo + coAssignees + createdBy
  const leadCreateRecipients = buildLeadRecipients(lead);
  if (leadCreateRecipients.length) {
    await createNotificationsWithSender({
      recipientIds: leadCreateRecipients,
      senderId: createdBy,
      organization,
      leadId: lead._id,
      title: `Lead Created: ${lead.name}`,
      message: `${req.user.name} created a new lead ${lead.name}.`,
      type: "lead_created",
      actionUrl: `/leads/${lead._id}`,
    });
  }

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

  const activityList = Array.isArray(activities)
    ? activities
    : activity && activity.type
      ? [activity]
      : [];

  for (const act of activityList) {
    if (!act?.type) continue;
    const activityData = {
      leadId: lead._id,
      type: act.type,
      text: act.text || "",
      createdBy: req.user._id,
      organization,
      notifiedUsers: Array.isArray(act.notifiedUsers)
        ? act.notifiedUsers.filter(Boolean)
        : act.notifiedUsers
          ? [act.notifiedUsers]
          : [],
    };
    if (act.type === "Call") {
      activityData.callDuration = act.callDuration;
      activityData.callDirection = act.callDirection;
      activityData.callOutcome = act.callOutcome;
    }
    if (act.type === "Task") {
      activityData.taskDueDate = act.taskDueDate;
      activityData.taskAssignedTo = act.taskAssignedTo;
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
    activityPromises.push(
      Activity.create({
        leadId: lead._id,
        type: "Payment",
        text: `Payment recorded: ₹${payment.amount}${payment.reference ? ` (${payment.reference})` : ""}`,
        paymentAmount: payment.amount,
        paymentMode: payment.paymentMode,
        paymentStatus: payment.status || "Paid",
        paymentReference: payment.reference,
        paymentDate: payment.paymentDate || new Date(),
        createdBy: req.user._id,
        organization,
      }),
    );
  }

  if (reminder && reminder.reminderDate) {
    const reminderItem = new Reminder({
      leadId: lead._id,
      type: reminder.type || "Call",
      assignedTo: reminder.assignedTo || createdBy,
      reminderDate: new Date(reminder.reminderDate),
      reminderTime: reminder.reminderTime || "10:00",
      note: reminder.note || "",
      notifyUsers: reminder.notifyUsers || [],
      organization,
    });
    await reminderItem.save();

    // ── Smart reminder notification ──
    await sendReminderNotification({
      lead,
      reminder: reminderItem,
      userId: createdBy,
      userName: req.user.name,
      organization,
      action: "created",
    });

    await Activity.create({
      leadId: lead._id,
      type: "Reminder",
      text: `Reminder Created: ${reminder.type || "Call"} on ${new Date(
        reminder.reminderDate,
      ).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })} at ${reminder.reminderTime || "10:00"}${
        reminder.note ? ` — ${reminder.note}` : ""
      }`,
      createdBy: createdBy,
      organization,
    });

    const gcalEventId = await createGcalEventForReminder(
      organization,
      reminderItem,
      lead,
    );
    if (gcalEventId) {
      await Reminder.findByIdAndUpdate(reminderItem._id, { gcalEventId });
    }
  }

  const results = await Promise.allSettled(activityPromises);
  results.forEach((r) => {
    if (r.status === "rejected") {
      logger.warn(`Activity creation failed: ${r.reason}`);
    }
  });

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
  const userName = req.user.name;

  const lead = await Lead.findOne({ _id: id, organization });
  if (!lead) {
    throw new ApiError(404, "Lead not found");
  }

  const canEditAny =
    req.user.role === "admin" ||
    (await canUser(req.user, organization, "edit_any_lead"));
  const isAssignee = lead.assignedTo && lead.assignedTo.equals(userId);
  const isCoAssignee = lead.coAssignees.some((user) => user.equals(userId));
  if (!canEditAny && !isAssignee && !isCoAssignee) {
    throw new ApiError(403, "Not authorized to update this lead");
  }

  // ── OLD VALUES save karo (comparison ke liye) ──
  const oldLead = {
    name: lead.name,
    phone: lead.phone,
    alternatePhone: lead.alternatePhone,
    email: lead.email,
    city: lead.city,
    source: lead.source,
    status: lead.status,
    dealValue: lead.dealValue,
    product: lead.product,
    closeDate: lead.closeDate,
    priority: lead.priority,
    initialNote: lead.initialNote,
    customFields:
      lead.customFields instanceof Map
        ? Object.fromEntries(lead.customFields)
        : { ...(lead.customFields || {}) },
    coAssignees: lead.coAssignees
      ? lead.coAssignees.map((id) => String(id))
      : [],
  };

  const oldStatus = lead.status;
  const oldAssigneeId = lead.assignedTo && lead.assignedTo.toString();

  // ── note field handle ──
  if (req.body.note !== undefined) {
    lead.initialNote = req.body.note;
  }

  // ── Profile fields update ──
  const allowedFields = [
    "name",
    "phone",
    "alternatePhone",
    "email",
    "city",
    "source",
    "status",
    "dealValue",
    "product",
    "closeDate",
    "priority",
    "initialNote",
    "customFields",
  ];

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      lead[field] = req.body[field];
    }
  });

  // ── Product array handle ──
  if (req.body.product !== undefined) {
    lead.product = Array.isArray(req.body.product)
      ? req.body.product.join(", ")
      : req.body.product;
  }

  // ── Recording handle ──
  const previousRecording = lead.recording
    ? { label: lead.recording.label || "", url: lead.recording.url || "" }
    : { label: "", url: "" };

  let recordingChanged = false;
  let incomingRecording = { label: "", url: "" };

  if (req.body.recording !== undefined) {
    const rp = req.body.recording || {};
    incomingRecording = {
      label: rp.label || "",
      url: rp.url || "",
    };
    recordingChanged =
      incomingRecording.label !== previousRecording.label ||
      incomingRecording.url !== previousRecording.url;
    lead.recording = incomingRecording;
  }

  // ── Co-assignees handle ──
  if (req.body.coAssignees !== undefined) {
    const hasAssignPermission =
      req.user.role === "admin" ||
      (await canUser(req.user, organization, "assign_leads"));

    if (!hasAssignPermission) {
      throw new ApiError(
        403,
        "Not authorized to modify co-assignees for this lead",
      );
    }

    const coAssigneeIds = Array.isArray(req.body.coAssignees)
      ? req.body.coAssignees
      : [req.body.coAssignees];
    const uniqueIds = [
      ...new Set(coAssigneeIds.map((id) => String(id).trim()).filter(Boolean)),
    ];

    if (uniqueIds.length > 0) {
      const foundCount = await User.countDocuments({
        _id: { $in: uniqueIds },
        organization,
      });
      if (foundCount !== uniqueIds.length) {
        throw new ApiError(
          400,
          "One or more co-assignees are not found in organization",
        );
      }
    }

    lead.coAssignees = uniqueIds;
  }

  // ── Assignee handle ──
  const requestedAssignedTo =
    req.body.assignedTo ?? req.body.assignee ?? req.body.assigned_to;

  if (requestedAssignedTo !== undefined) {
    const hasAssignPermission =
      req.user.role === "admin" ||
      (await canUser(req.user, organization, "assign_leads"));

    if (!hasAssignPermission) {
      throw new ApiError(403, "Not authorized to reassign this lead");
    }

    const assignee = await User.findOne({
      _id: requestedAssignedTo,
      organization,
    });
    if (!assignee) {
      throw new ApiError(400, "Assigned user not found in organization");
    }

    lead.assignedTo = requestedAssignedTo;
  }

  await lead.save();
  await lead.populate("assignedTo", "name email");

  // ════════════════════════════════════════════════════════════
  //  SMART NOTIFICATIONS - Sirf actual change pe trigger hongi
  // ════════════════════════════════════════════════════════════

  const isReassigned =
    requestedAssignedTo !== undefined &&
    oldAssigneeId !== String(requestedAssignedTo);

  // ── 1. REASSIGNMENT notification ──
  if (isReassigned) {
    const newAssignee = await User.findById(requestedAssignedTo).select("name");
    const oldAssignee = oldAssigneeId
      ? await User.findById(oldAssigneeId).select("name")
      : null;

    await sendReassignmentNotification({
      lead,
      oldAssigneeId,
      newAssigneeName: newAssignee?.name,
      oldAssigneeName: oldAssignee?.name,
      userId,
      userName,
      organization,
    });

    // Reassignment activity log
    await Activity.create({
      leadId: lead._id,
      type: "Lead Reassignment",
      text: `Lead reassigned from ${oldAssignee?.name || "Unassigned"} to ${newAssignee?.name || "Unknown"}`,
      createdBy: userId,
      organization,
    });
  }

  // ── 2. STATUS CHANGE notification ──
  // Sirf tab jab status actually change hua ho
  if (oldStatus !== lead.status) {
    await sendStatusChangeNotification({
      lead,
      oldStatus,
      newStatus: lead.status,
      userId,
      userName,
      organization,
    });

    await Activity.create({
      leadId: lead._id,
      type: "Status Change",
      text: `Status changed from ${oldStatus} to ${lead.status}`,
      statusFrom: oldStatus,
      statusTo: lead.status,
      createdBy: userId,
      organization,
    });
  }

  // ── 3. CO-ASSIGNEES change notification ──
  if (req.body.coAssignees !== undefined) {
    const oldCoIds = (oldLead.coAssignees || []).map(String).sort().join(",");
    const newCoIds = (lead.coAssignees || []).map(String).sort().join(",");

    if (oldCoIds !== newCoIds) {
      const oldSet = new Set(oldLead.coAssignees || []);
      const newSet = new Set((lead.coAssignees || []).map(String));

      const addedIds = [...newSet].filter((id) => !oldSet.has(id));
      const removedIds = [...oldSet].filter((id) => !newSet.has(id));

      let addedNames = [];
      if (addedIds.length) {
        const addedUsers = await User.find({ _id: { $in: addedIds } })
          .select("name")
          .lean();
        addedNames = addedUsers.map((u) => u.name);
      }

      let removedNames = [];
      if (removedIds.length) {
        const removedUsers = await User.find({ _id: { $in: removedIds } })
          .select("name")
          .lean();
        removedNames = removedUsers.map((u) => u.name);
      }

      const hadCoAssigneesBefore = oldLead.coAssignees.length > 0;
      const ACTION = hadCoAssigneesBefore ? "Updated" : "Added";

      const parts = [];
      if (addedNames.length) parts.push(`added ${addedNames.join(", ")}`);
      if (removedNames.length) parts.push(`removed ${removedNames.join(", ")}`);

      if (parts.length) {
        const recipients = buildLeadRecipients(lead, removedIds);
        if (recipients.length) {
          await createNotificationsWithSender({
            recipientIds: recipients,
            senderId: userId,
            organization,
            leadId: lead._id,
            title: `Co-assignee ${ACTION}: ${lead.name}`,
            message: `${userName} ${parts.join(" and ")} as co-assignee${
              addedNames.length + removedNames.length > 1 ? "s" : ""
            } for lead ${lead.name}.`,
            type: "lead_co_assignee_added",
            actionUrl: `/leads/${lead._id}`,
          });
        }
      }
    }
  }

  // ── 4. PROFILE UPDATE notification ──
  // Sirf profile fields change hone par, status aur reassign se alag
  await sendProfileUpdateNotification({
    lead,
    oldLead,
    userId,
    userName,
    organization,
  });
  // ── 5. RECORDING notification ──
  // Sirf tab jab recording actually change hui ho
  if (recordingChanged) {
    // Smart action detect karo
    const wasEmpty = !previousRecording.url && !previousRecording.label;
    const isNowEmpty = !incomingRecording.url && !incomingRecording.label;

    let recordingAction;
    if (wasEmpty && !isNowEmpty) {
      recordingAction = "added"; // pehle kuch nahi tha, ab add hua
    } else if (!wasEmpty && isNowEmpty) {
      recordingAction = "deleted"; // pehle tha, ab clear kar diya
    } else if (!wasEmpty && !isNowEmpty) {
      recordingAction = "updated"; // pehle bhi tha, ab change hua
    } else {
      recordingAction = null; // dono empty, skip
    }

    if (recordingAction) {
      await sendRecordingNotification({
        lead,
        recording: incomingRecording,
        previousRecording,
        userId,
        userName,
        organization,
        action: recordingAction,
      });

      await Activity.create({
        leadId: lead._id,
        type: "Recording",
        text: `Recording ${recordingAction}${
          incomingRecording.label ? `: ${incomingRecording.label}` : ""
        }`,
        recordingUrl: incomingRecording.url || undefined,
        createdBy: userId,
        organization,
      });
    }
  }

  // ════════════════════════════════════════════════════════════
  //  ACTIVITIES - Smart change detection
  // ════════════════════════════════════════════════════════════
  const activityList = Array.isArray(req.body.activities)
    ? req.body.activities
    : req.body.activity && req.body.activity.type
      ? [req.body.activity]
      : [];

  for (const act of activityList) {
    if (!act?.type) continue;

    const activityData = {
      leadId: lead._id,
      type: act.type,
      text: act.text !== undefined ? act.text : "",
      createdBy: userId,
      organization,
      notifiedUsers: Array.isArray(act.notifiedUsers)
        ? act.notifiedUsers.filter(Boolean)
        : act.notifiedUsers
          ? [act.notifiedUsers]
          : [],
    };

    if (act.type === "Call") {
      activityData.callDuration =
        act.callDuration !== undefined ? act.callDuration : "";
      activityData.callDirection = act.callDirection;
      activityData.callOutcome = act.callOutcome;
    }

    if (act.type === "Task") {
      activityData.taskDueDate =
        act.taskDueDate !== undefined ? act.taskDueDate : "";
      activityData.taskAssignedTo = act.taskAssignedTo;
      activityData.taskCompleted = false;
    }

    let savedActivity = null;
    let isUpdate = false;

    if (act._id) {
      // Existing activity - change detect karo
      const existingActivity = await Activity.findOne({
        _id: act._id,
        organization,
      });
      if (!existingActivity) continue;

      // detectActivityChange use karo
      const hasChanged = detectActivityChange(
        existingActivity,
        activityData,
        act.type,
      );

      if (!hasChanged) {
        logger.info(`Activity ${act._id} unchanged, skipping`);
        continue; // Koi change nahi - skip
      }

      Object.assign(existingActivity, activityData);
      savedActivity = await existingActivity.save();
      isUpdate = true;
    } else if (activityData.text.trim()) {
      // New activity
      savedActivity = await Activity.create(activityData);
      isUpdate = false;
    }

    // Sirf tab notification bhejo jab activity actually save hui
    if (savedActivity) {
      await sendActivityNotification({
        lead,
        activity: savedActivity,
        userId,
        userName,
        organization,
        isUpdate,
      });
    }
  }

  // ════════════════════════════════════════════════════════════
  //  PAYMENT - Smart change detection
  // ════════════════════════════════════════════════════════════
  if (req.body.payment && req.body.payment.amount !== undefined) {
    const paymentPayload = {
      leadId: lead._id,
      amount: req.body.payment.amount,
      currency: "INR",
      paymentMode: req.body.payment.paymentMode,
      status: req.body.payment.status || "Paid",
      reference: req.body.payment.reference,
      paymentDate: req.body.payment.paymentDate
        ? new Date(req.body.payment.paymentDate)
        : new Date(),
      recordedBy: userId,
      organization,
    };

    await Payment.create(paymentPayload);

    await Activity.create({
      leadId: lead._id,
      type: "Payment",
      text: `Payment recorded: ₹${paymentPayload.amount}${paymentPayload.reference ? ` (${paymentPayload.reference})` : ""}`,
      paymentAmount: paymentPayload.amount,
      paymentMode: paymentPayload.paymentMode,
      paymentStatus: paymentPayload.status,
      paymentReference: paymentPayload.reference,
      paymentDate: paymentPayload.paymentDate,
      createdBy: userId,
      organization,
    });

    await sendPaymentNotification({
      lead,
      payment: paymentPayload,
      userId,
      userName,
      organization,
      isUpdate: false,
    });
  }

  // ════════════════════════════════════════════════════════════
  //  REMINDER - Smart create/update
  // ════════════════════════════════════════════════════════════
  if (req.body.reminder && req.body.reminder.reminderDate) {
    const reminderData = req.body.reminder;

    if (reminderData._id) {
      // Update existing reminder
      const existingReminder = await Reminder.findById(reminderData._id);
      if (existingReminder) {
        const oldDate = existingReminder.reminderDate;
        const oldTime = existingReminder.reminderTime;

        existingReminder.type = reminderData.type;
        existingReminder.assignedTo = reminderData.assignedTo;
        existingReminder.reminderDate = new Date(reminderData.reminderDate);
        existingReminder.reminderTime = reminderData.reminderTime;
        existingReminder.note = reminderData.note;
        existingReminder.notifyUsers = Array.isArray(reminderData.notifyUsers)
          ? reminderData.notifyUsers.filter(Boolean)
          : reminderData.notifyUsers
            ? [reminderData.notifyUsers]
            : [];
        await existingReminder.save();

        // Smart reminder updated notification
        await sendReminderNotification({
          lead,
          reminder: existingReminder,
          userId,
          userName,
          organization,
          action: "updated",
        });

        await Activity.create({
          leadId: lead._id,
          type: "Reminder",
          text: `Reminder updated: ${reminderData.type || "Call"} on ${new Date(
            reminderData.reminderDate,
          ).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })} at ${reminderData.reminderTime || "10:00"}${
            reminderData.note ? ` — ${reminderData.note}` : ""
          }`,
          createdBy: userId,
          organization,
        });

        // GCal update if date/time changed
        const dateChanged =
          oldDate.toDateString() !==
          existingReminder.reminderDate.toDateString();
        const timeChanged = oldTime !== existingReminder.reminderTime;
        if ((dateChanged || timeChanged) && existingReminder.gcalEventId) {
          await updateGcalEventForReminder(
            organization,
            existingReminder,
            lead,
          );
        }
      }
    } else {
      // Create new reminder
      const newReminder = await Reminder.create({
        leadId: lead._id,
        type: reminderData.type || "Call",
        assignedTo: reminderData.assignedTo || userId,
        reminderDate: new Date(reminderData.reminderDate),
        reminderTime: reminderData.reminderTime || "10:00",
        note: reminderData.note || "",
        notifyUsers: Array.isArray(reminderData.notifyUsers)
          ? reminderData.notifyUsers.filter(Boolean)
          : reminderData.notifyUsers
            ? [reminderData.notifyUsers]
            : [],
        organization,
      });

      // Smart reminder created notification
      await sendReminderNotification({
        lead,
        reminder: newReminder,
        userId,
        userName,
        organization,
        action: "created",
      });

      await Activity.create({
        leadId: lead._id,
        type: "Reminder",
        text: `Reminder Created: ${reminderData.type || "Call"} on ${new Date(
          reminderData.reminderDate,
        ).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })} at ${reminderData.reminderTime || "10:00"}${
          reminderData.note ? ` — ${reminderData.note}` : ""
        }`,
        createdBy: userId,
        organization,
      });

      const gcalEventId = await createGcalEventForReminder(
        organization,
        newReminder,
        lead,
      );
      if (gcalEventId) {
        await Reminder.findByIdAndUpdate(newReminder._id, { gcalEventId });
      }
    }
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

  const lead = await Lead.findOne({ _id: id, organization });
  if (!lead) {
    throw new ApiError(404, "Lead not found");
  }

  if (req.user.role !== "admin" && !lead.assignedTo.equals(req.user._id)) {
    throw new ApiError(403, "Not authorized to delete this lead");
  }

  // ── Delete notification - buildLeadRecipients use karo ──
  const deleteRecipients = buildLeadRecipients(lead);
  if (deleteRecipients.length) {
    await createNotificationsWithSender({
      recipientIds: deleteRecipients,
      senderId: req.user._id,
      organization,
      leadId: lead._id,
      title: `Lead Deleted: ${lead.name}`,
      message: `${req.user.name} deleted lead ${lead.name}.`,
      type: "lead_deleted",
      actionUrl: `/leads/${lead._id}`,
    });
  }

  const reminders = await Reminder.find({ leadId: id, organization });

  for (const reminder of reminders) {
    if (reminder.gcalEventId) {
      try {
        const settings = await Settings.findOne({ organization });
        if (settings?.gcalConnected && settings?.gcalTokens?.access_token) {
          const client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI,
          );
          client.setCredentials({
            access_token: settings.gcalTokens.access_token,
            refresh_token: settings.gcalTokens.refresh_token,
            expiry_date: settings.gcalTokens.expiry_date,
          });
          const calendar = google.calendar({ version: "v3", auth: client });
          await calendar.events.delete({
            calendarId: "primary",
            eventId: reminder.gcalEventId,
          });
          logger.info(
            `GCal event ${reminder.gcalEventId} deleted for reminder ${reminder._id}`,
          );
        }
      } catch (err) {
        logger.warn(
          `Failed to delete GCal event for reminder ${reminder._id}: ${err.message}`,
        );
      }
    }
  }

  await Reminder.deleteMany({ leadId: id });
  await Lead.findByIdAndDelete(id);
  await Activity.deleteMany({ leadId: id });

  logger.info(
    `Lead and associated data deleted: ${id} by user ${req.user._id}`,
  );

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

  // Same status → skip
  if (oldStatus === status) {
    return res.status(200).json(new ApiResponse(200, lead, "Status unchanged"));
  }

  lead.status = status;
  await lead.save();

  await Activity.create({
    leadId: lead._id,
    type: "Status Change",
    text: `Status changed from ${oldStatus} to ${status} by ${req.user.name}`,
    statusFrom: oldStatus,
    statusTo: status,
    createdBy: userId,
    organization,
  });

  // Smart status notification
  await sendStatusChangeNotification({
    lead,
    oldStatus,
    newStatus: status,
    userId,
    userName: req.user.name,
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
  const assignedTo =
    req.body.assignedTo || req.body.assignee || req.body.assigned_to;
  const organization = req.user.organization;
  const userId = req.user._id;

  const lead = await Lead.findOne({ _id: id, organization });
  if (!lead) {
    throw new ApiError(404, "Lead not found");
  }

  const user = await User.findOne({ _id: assignedTo, organization });
  if (!user) {
    throw new ApiError(400, "User not found in organization");
  }

  const previousAssigneeId = lead.assignedTo?.toString();
  const previousAssignee = previousAssigneeId
    ? await User.findById(previousAssigneeId).select("name")
    : null;

  lead.assignedTo = assignedTo;
  await lead.save();
  await lead.populate("assignedTo", "name email");

  await Activity.create({
    leadId: lead._id,
    type: "Lead Reassignment",
    text: `Lead reassigned from ${previousAssignee?.name || "Unassigned"} to ${user.name}`,
    createdBy: userId,
    organization,
  });

  if (previousAssigneeId !== String(assignedTo)) {
    await sendReassignmentNotification({
      lead,
      oldAssigneeId: previousAssigneeId,
      newAssigneeName: user.name,
      oldAssigneeName: previousAssignee?.name,
      userId,
      userName: req.user.name,
      organization,
    });
  }

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

  const user = await User.findOne({ _id: userId, organization });
  if (!user) {
    throw new ApiError(400, "User not found in organization");
  }

  if (lead.coAssignees.includes(userId)) {
    throw new ApiError(400, "User is already a co-assignee");
  }

  lead.coAssignees.push(userId);
  await lead.save();
  await lead.populate("coAssignees", "name email");

  await Activity.create({
    leadId: lead._id,
    type: "Note",
    text: `Added co-assignee ${user.name}`,
    createdBy: req.user._id,
    organization,
  });

  // buildLeadRecipients use karo
  const coAssigneeRecipients = buildLeadRecipients(lead);
  if (coAssigneeRecipients.length) {
    await createNotificationsWithSender({
      recipientIds: coAssigneeRecipients,
      senderId: req.user._id,
      organization,
      leadId: lead._id,
      title: `Co-assignee Added: ${lead.name}`,
      message: `${req.user.name} added ${user.name} as a co-assignee for lead ${lead.name}.`,
      type: "lead_co_assignee_added",
      actionUrl: `/leads/${lead._id}`,
    });
  }

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

  const removedUser = await User.findOne({ _id: userId, organization });
  await Activity.create({
    leadId: lead._id,
    type: "Note",
    text: `Removed co-assignee ${removedUser?.name || userId}`,
    createdBy: req.user._id,
    organization,
  });

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

/**
 * Bulk delete leads
 * @route DELETE /api/v1/leads/bulk
 * @access Private
 */
export const bulkDeleteLeads = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  const organization = req.user.organization;

  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ApiError(400, "No lead IDs provided");
  }

  const canDelete =
    req.user.role === "admin" ||
    (await canUser(req.user, organization, "delete_leads"));
  if (!canDelete) {
    throw new ApiError(403, "Not authorized to delete leads");
  }

  await Promise.all([
    Activity.deleteMany({ leadId: { $in: ids }, organization }),
    Reminder.deleteMany({ leadId: { $in: ids }, organization }),
    Payment.deleteMany({ leadId: { $in: ids }, organization }),
  ]);

  const result = await Lead.deleteMany({ _id: { $in: ids }, organization });

  logger.info(
    `Bulk deleted ${result.deletedCount} leads by user ${req.user._id}`,
  );

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { deleted: result.deletedCount },
        `${result.deletedCount} leads deleted successfully`,
      ),
    );
});

/**
 * Bulk assign leads
 * @route PATCH /api/v1/leads/bulk/assign
 * @access Private
 */
export const bulkAssignLeads = asyncHandler(async (req, res) => {
  const { ids, assignedTo } = req.body;
  const organization = req.user.organization;
  const userId = req.user._id;

  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ApiError(400, "No lead IDs provided");
  }
  if (!assignedTo) {
    throw new ApiError(400, "assignedTo is required");
  }

  const hasPermission =
    req.user.role === "admin" ||
    (await canUser(req.user, organization, "assign_leads"));
  if (!hasPermission) {
    throw new ApiError(403, "Not authorized to assign leads");
  }

  const assignee = await User.findOne({ _id: assignedTo, organization });
  if (!assignee) {
    throw new ApiError(400, "Assigned user not found in organization");
  }

  await Lead.updateMany(
    { _id: { $in: ids }, organization },
    { $set: { assignedTo } },
  );

  const activities = ids.map((leadId) => ({
    leadId,
    type: "Note",
    text: `Lead bulk assigned to ${assignee.name} by ${req.user.name}`,
    createdBy: userId,
    organization,
  }));
  await Activity.insertMany(activities);

  logger.info(
    `Bulk assigned ${ids.length} leads to ${assignedTo} by user ${userId}`,
  );

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { updated: ids.length },
        `${ids.length} leads assigned to ${assignee.name}`,
      ),
    );
});

/**
 * Get lead IDs for bulk operations with filters
 * @route GET /api/v1/leads/ids
 * @access Private
 */
export const getLeadIds = asyncHandler(async (req, res) => {
  const {
    status,
    source,
    assignedTo,
    search,
    priority,
    dateFrom,
    dateTo,
    dateFilterType,
  } = req.query;

  const userId = req.user._id;
  const organization = req.user.organization;
  const isAdmin = req.user.role === "admin";
  const canViewAllLeads =
    isAdmin || (await canUser(req.user, organization, "view_all_leads"));

  const filter = { organization };

  if (status) {
    const statusParam = String(status).trim();
    if (statusParam === "active") {
      filter.status = { $nin: ["Success", "Closed"] };
    } else {
      filter.status = statusParam;
    }
  }

  if (source) filter.source = source;
  if (priority) filter.priority = priority;

  if (dateFrom || dateTo) {
    const dateField =
      dateFilterType === "closeDate" ? "closeDate" : "createdAt";
    const dateFilter = {};
    if (dateFrom) dateFilter.$gte = new Date(dateFrom);
    if (dateTo) {
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      dateFilter.$lte = endDate;
    }
    if (Object.keys(dateFilter).length > 0) {
      filter[dateField] = dateFilter;
    }
  }

  let accessFilter = null;
  if (canViewAllLeads) {
    if (assignedTo) filter.assignedTo = assignedTo;
  } else {
    accessFilter = { $or: [{ assignedTo: userId }, { coAssignees: userId }] };
  }

  if (search) {
    const searchFilter = {
      $or: [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
        { alternatePhone: { $regex: search, $options: "i" } },
      ],
    };
    if (accessFilter) {
      filter.$and = [accessFilter, searchFilter];
    } else {
      filter.$or = searchFilter.$or;
    }
  } else if (accessFilter) {
    Object.assign(filter, accessFilter);
  }

  const leads = await Lead.find(filter).select("_id").lean();
  const ids = leads.map((l) => l._id);

  res.status(200).json(new ApiResponse(200, { ids }, "Lead IDs fetched"));
});
