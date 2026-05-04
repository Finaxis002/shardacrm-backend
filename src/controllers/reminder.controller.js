import Reminder from "../models/Reminder.model.js";
import Lead from "../models/Lead.model.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { formatPaginatedResponse, parsePagination } from "../utils/paginate.js";
import logger from "../utils/logger.js";
import { google } from "googleapis";
import Settings from "../models/Settings.model.js";
import { createNotifications } from "../utils/notification.utils.js";

// ── Google Calendar Helper ────────────────────────────────────────────────────

const makeOAuth2Client = () =>
  new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );

const createGcalEvent = async (organization, reminder, lead) => {
  try {
    const settings = await Settings.findOne({ organization });

    // Only proceed if GCal is connected
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

    // Auto-persist refreshed tokens
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

    // Build start datetime from reminderDate + reminderTime
    const dateStr = reminder.reminderDate.toISOString().split("T")[0]; // "2026-05-10"
    const timeStr = reminder.reminderTime || "09:00"; // "14:30"
    const startDateTime = new Date(`${dateStr}T${timeStr}:00`);
    const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000); // +1 hour

    const eventTitle = `${reminder.type || "Follow-up"}: ${lead.name}`;
    const description = [
      `Lead: ${lead.name}`,
      `Phone: ${lead.phone || "N/A"}`,
      `Type: ${reminder.type || "Follow-up"}`,
      reminder.note ? `Note: ${reminder.note}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const calendar = google.calendar({ version: "v3", auth: client });

    const { data } = await calendar.events.insert({
      calendarId: "primary",
      resource: {
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
            reminderId: reminder._id.toString(),
            leadId: lead._id.toString(),
          },
        },
      },
    });

    logger.info(`GCal event created for reminder ${reminder._id}: ${data.id}`);
    return data.id;
  } catch (err) {
    // Don't fail reminder creation if GCal fails
    logger.warn(`GCal event creation failed (non-fatal): ${err.message}`);
    return null;
  }
};

const buildReminderNotificationRecipients = (reminder) => {
  const ids = [
    reminder.assignedTo?.toString?.() || reminder.assignedTo,
    ...(Array.isArray(reminder.notifyUsers)
      ? reminder.notifyUsers.map((id) => id?.toString?.() || id)
      : []),
  ];
  return Array.from(new Set(ids.filter(Boolean)));
};

const formatReminderDateTime = (reminder) => {
  const date = new Date(reminder.reminderDate);
  const dateStr = date.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return `${dateStr}${reminder.reminderTime ? ` at ${reminder.reminderTime}` : ""}`;
};

// ── Controllers ───────────────────────────────────────────────────────────────

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

  const {
    skip,
    limit: pageLimit,
    page: pageNum,
  } = parsePagination({ page, limit });

  const reminders = await Reminder.find(filter)
    .skip(skip)
    .limit(pageLimit)
    .populate("leadId", "name phone email")
    .populate("assignedTo", "name email")
    .populate("doneBy", "name email")
    .sort({ reminderDate: 1 })
    .lean();

  const total = await Reminder.countDocuments(filter);

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        formatPaginatedResponse(reminders, total, pageNum, pageLimit),
        "Reminders fetched successfully",
      ),
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
 * Create reminder + auto-create Google Calendar event if GCal connected
 * @route POST /api/v1/reminders
 * @access Private
 */
export const createReminder = asyncHandler(async (req, res) => {
  const {
    leadId,
    type,
    assignedTo,
    reminderDate,
    reminderTime,
    note,
    notifyUsers,
  } = req.body;

  const organization = req.user.organization;
  const createdBy = req.user._id;

  // Validate lead exists
  const lead = await Lead.findOne({ _id: leadId, organization });
  if (!lead) {
    throw new ApiError(404, "Lead not found");
  }

  const normalizedNotifyUsers = Array.isArray(notifyUsers)
    ? notifyUsers.filter(Boolean)
    : notifyUsers
      ? [notifyUsers]
      : [];

  const reminder = new Reminder({
    leadId,
    type,
    assignedTo: assignedTo || createdBy,
    reminderDate,
    reminderTime,
    note,
    organization,
    notifyUsers:
      normalizedNotifyUsers.length > 0
        ? normalizedNotifyUsers
        : [assignedTo || createdBy],
  });

  await reminder.save();
  await reminder.populate("leadId", "name phone");
  await reminder.populate("assignedTo", "name email");

  const reminderRecipients = buildReminderNotificationRecipients(reminder);
  if (reminderRecipients.length) {
    await createNotifications({
      recipientIds: reminderRecipients,
      senderId: req.user._id,
      organization,
      leadId,
      title: `Reminder created: ${reminder.type || "Follow-up"}`,
      message: `${req.user.name} created a ${reminder.type || "Follow-up"} reminder for lead ${reminder.leadId?.name || "Lead"} on ${formatReminderDateTime(reminder)}.`,
      type: "reminder",
      actionUrl: `/leads/${leadId}`,
    });
  }

  logger.info(`Reminder created: ${reminder._id} for lead ${leadId}`);

  // ── Auto-create Google Calendar event ──────────────────────────────────────
  const gcalEventId = await createGcalEvent(organization, reminder, lead);
  if (gcalEventId) {
    // Save GCal event ID in reminder for future reference (optional)
    await Reminder.findByIdAndUpdate(reminder._id, { gcalEventId });
    reminder.gcalEventId = gcalEventId;
  }

  res
    .status(201)
    .json(
      new ApiResponse(
        201,
        reminder,
        gcalEventId
          ? "Reminder created and synced to Google Calendar ✅"
          : "Reminder created successfully",
      ),
    );
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

  if (req.body.notifyUsers !== undefined) {
    reminder.notifyUsers = Array.isArray(req.body.notifyUsers)
      ? req.body.notifyUsers.filter(Boolean)
      : req.body.notifyUsers
        ? [req.body.notifyUsers]
        : [];
  }

  Object.assign(reminder, {
    ...req.body,
    notifyUsers: reminder.notifyUsers,
  });
  await reminder.save();
  await reminder.populate("leadId", "name phone");
  await reminder.populate("assignedTo", "name email");

  const reminderRecipients = buildReminderNotificationRecipients(reminder);
  if (reminderRecipients.length) {
    await createNotifications({
      recipientIds: reminderRecipients,
      senderId: userId,
      organization,
      leadId: reminder.leadId,
      title: `Reminder updated: ${reminder.type || "Follow-up"}`,
      message: `${req.user.name} updated the ${reminder.type || "Follow-up"} reminder for lead ${reminder.leadId?.name || "Lead"} to ${formatReminderDateTime(reminder)}.`,
      type: "reminder",
      actionUrl: `/leads/${reminder.leadId}`,
    });
  }

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

  // Delete GCal event too if it exists
  if (reminder.gcalEventId) {
    try {
      const settings = await Settings.findOne({ organization });
      if (settings?.gcalConnected && settings?.gcalTokens?.access_token) {
        const client = makeOAuth2Client();
        client.setCredentials(settings.gcalTokens);
        const calendar = google.calendar({ version: "v3", auth: client });
        await calendar.events.delete({
          calendarId: "primary",
          eventId: reminder.gcalEventId,
        });
        logger.info(`GCal event deleted: ${reminder.gcalEventId}`);
      }
    } catch (err) {
      logger.warn(`GCal event delete failed (non-fatal): ${err.message}`);
    }
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
    isDone: false,
    reminderDate: { $gte: today, $lt: tomorrow },
  })
    .populate("leadId", "name phone email")
    .populate("assignedTo", "name email")
    .sort({ reminderTime: 1 })
    .lean();

  res
    .status(200)
    .json(
      new ApiResponse(200, reminders, "Today's reminders fetched successfully"),
    );
});
