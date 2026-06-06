import { google } from "googleapis";
import Event from "../models/Event.model.js";
import Settings from "../models/Settings.model.js";
import User from "../models/User.model.js";
import ApiResponse from "../utils/apiResponse.js";
import ApiError from "../utils/apiError.js";
import asyncHandler from "../utils/asyncHandler.js";
import { createNotifications } from "../utils/notification.utils.js";

const makeOAuth2Client = () =>
  new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );

const getUserGcalClient = async (userId) => {
  if (!userId) return null;
  const user = await User.findById(userId).select(
    "+gcalTokens.access_token +gcalTokens.refresh_token +gcalTokens.expiry_date +gcalTokens.token_type +gcalTokens.scope",
  );
  if (!user?.gcalTokens?.access_token) return null;

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

const getId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value._id) return String(value._id);
  if (value.id) return String(value.id);
  const stringValue = value.toString?.();
  return stringValue && !stringValue.startsWith("[object") ? stringValue : "";
};

const getAssignedToIds = (eventDoc) =>
  Array.isArray(eventDoc.assignedTo)
    ? eventDoc.assignedTo.map(getId).filter(Boolean)
    : [];

const buildEventGcalResource = ({
  title,
  note,
  eventDate,
  eventTime,
  timezone,
  assignedToIds,
  createdById,
  eventId,
}) => {
  const start = new Date(`${eventDate}T${eventTime || "10:00"}:00`);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const description = [
    note ? `Note: ${note}` : "",
    `Assigned To: ${assignedToIds.join(", ")}`,
    `Created By: ${createdById}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    summary: title,
    description,
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
        eventId,
        eventDate,
        eventTime,
        assignedTo: assignedToIds.join(","),
        createdBy: createdById,
      },
    },
  };
};

const createGcalEventForUser = async (payload) => {
  try {
    const client = await getUserGcalClient(payload.userId);
    if (!client) return null;

    const calendar = google.calendar({ version: "v3", auth: client });
    const { data } = await calendar.events.insert({
      calendarId: "primary",
      resource: buildEventGcalResource(payload),
    });

    return data.id;
  } catch (err) {
    return null;
  }
};

const updateGcalEventForUser = async (payload) => {
  try {
    const client = await getUserGcalClient(payload.userId);
    if (!client) return null;

    const calendar = google.calendar({ version: "v3", auth: client });
    const { data } = await calendar.events.update({
      calendarId: payload.calendarId || "primary",
      eventId: payload.gcalEventId,
      resource: buildEventGcalResource(payload),
    });

    return data.id;
  } catch (err) {
    return null;
  }
};

const deleteGcalEventForUser = async (
  userId,
  eventId,
  calendarId = "primary",
) => {
  if (!userId || !eventId) return false;
  try {
    const client = await getUserGcalClient(userId);
    if (!client) return false;

    const calendar = google.calendar({ version: "v3", auth: client });
    await calendar.events.delete({
      calendarId,
      eventId,
    });
    return true;
  } catch (err) {
    if (err?.code === 404 || err?.response?.status === 404) return true;
    return false;
  }
};

const deleteEventFromGoogleCalendars = async (eventDoc) => {
  const records = Array.isArray(eventDoc?.googleCalendarEvents)
    ? eventDoc.googleCalendarEvents
    : [];

  await Promise.allSettled(
    records.map((record) =>
      deleteGcalEventForUser(
        getId(record.user),
        record.eventId,
        record.calendarId || "primary",
      ),
    ),
  );
};

const syncEventToGoogleCalendars = async (eventDoc) => {
  const assignedToIds = getAssignedToIds(eventDoc);
  if (!assignedToIds.length) return;

  const existingRecords = Array.isArray(eventDoc.googleCalendarEvents)
    ? eventDoc.googleCalendarEvents
    : [];

  if (eventDoc.isDone) {
    await deleteEventFromGoogleCalendars(eventDoc);
    await Event.findByIdAndUpdate(eventDoc._id, {
      $set: { googleCalendarEvents: [] },
    });
    eventDoc.googleCalendarEvents = [];
    return;
  }

  const settings = await Settings.findOne({
    organization: eventDoc.organization,
  });
  const timezone = settings?.timezone || "Asia/Kolkata";
  const createdById = getId(eventDoc.createdBy);
  const eventId = String(eventDoc._id);
  const nextRecords = [];

  await Promise.allSettled(
    existingRecords
      .filter((record) => !assignedToIds.includes(getId(record.user)))
      .map((record) =>
        deleteGcalEventForUser(
          getId(record.user),
          record.eventId,
          record.calendarId || "primary",
        ),
      ),
  );

  for (const userId of assignedToIds) {
    const existing = existingRecords.find(
      (record) =>
        getId(record.user) === userId &&
        record.eventId &&
        record.syncStatus !== "deleted",
    );

    const payload = {
      userId,
      title: eventDoc.title,
      note: eventDoc.note,
      eventDate: eventDoc.eventDate,
      eventTime: eventDoc.eventTime,
      timezone,
      assignedToIds,
      createdById,
      eventId,
      gcalEventId: existing?.eventId,
      calendarId: existing?.calendarId || "primary",
    };

    const gcalEventId = existing?.eventId
      ? await updateGcalEventForUser(payload)
      : await createGcalEventForUser(payload);

    if (gcalEventId) {
      nextRecords.push({
        user: userId,
        eventId: gcalEventId,
        calendarId: existing?.calendarId || "primary",
        syncStatus: "synced",
        lastSyncedAt: new Date(),
      });
    } else if (existing?.eventId) {
      nextRecords.push({
        user: userId,
        eventId: existing.eventId,
        calendarId: existing.calendarId || "primary",
        syncStatus: existing.syncStatus || "synced",
        lastSyncedAt: existing.lastSyncedAt || new Date(),
      });
    }
  }

  await Event.findByIdAndUpdate(eventDoc._id, {
    $set: { googleCalendarEvents: nextRecords },
  });
  eventDoc.googleCalendarEvents = nextRecords;
};

// ── GET /api/v1/events ────────────────────────────────────────────────────────
export const getEvents = asyncHandler(async (req, res) => {
  const { limit, page = 1 } = req.query;
  let assignedTo = req.query.assignedTo;
  if (assignedTo === "all") assignedTo = undefined;
  const pageNum = parseInt(page, 10) || 1;
  const limitValue =
    String(limit || "").trim() === "0" ? 0 : Number(limit || 0);

  const filter = { organization: req.user.organization };
  const isAdmin = req.user.role === "admin" || req.user.role === "master";

  if (assignedTo) {
    if (isAdmin) {
      filter.assignedTo = assignedTo;
    } else if (String(assignedTo) === String(req.user._id)) {
      filter.assignedTo = assignedTo;
    } else {
      filter.assignedTo = req.user._id;
    }
  } else if (!isAdmin) {
    filter.assignedTo = req.user._id;
  }

  const query = Event.find(filter)
    .sort({ eventDate: 1, eventTime: 1 })
    .populate("assignedTo", "name email")
    .populate("createdBy", "name email")
    .populate("doneBy", "name email");

  if (limitValue > 0) {
    query.skip((pageNum - 1) * limitValue).limit(limitValue);
  }

  const [data, total] = await Promise.all([
    query,
    Event.countDocuments(filter),
  ]);

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { data, total, page: Number(page), limit: Number(limit) },
        "Events fetched",
      ),
    );
});

// ── POST /api/v1/events ───────────────────────────────────────────────────────
// ── POST /api/v1/events ───────────────────────────────────────────────────────
export const createEvent = asyncHandler(async (req, res) => {
  const { title, eventDate, eventTime, note, assignedTo } = req.body;

  if (!title?.trim()) throw new ApiError(400, "Event title is required");
  if (!eventDate) throw new ApiError(400, "Event date is required");
  if (!Array.isArray(assignedTo) || assignedTo.length === 0) {
    throw new ApiError(400, "At least one assigned user is required");
  }

  const event = await Event.create({
    title: title.trim(),
    eventDate,
    eventTime: eventTime || "10:00",
    note: note?.trim() || "",
    assignedTo,
    organization: req.user.organization,
    createdBy: req.user._id,
  });

  // Populate before returning so frontend gets name/email directly
  await event.populate("assignedTo", "name email");
  await event.populate("createdBy", "name email");

  // ── Notifications to all assigned users ──────────────────────────────────
  const recipientIds = assignedTo.map((id) => id?.toString?.() || id);

  const eventDateStr = new Date(eventDate).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  await createNotifications({
    recipientIds,
    senderId: req.user._id,
    organization: req.user.organization,
    title: `New Event: ${title.trim()}`,
    message: `${req.user.name} added an event "${title.trim()}" on ${eventDateStr}${eventTime ? ` at ${eventTime}` : ""}.${note?.trim() ? ` Note: ${note.trim()}` : ""}`,
    type: "reminder",
    actionUrl: "/calendar",
  });

  await syncEventToGoogleCalendars(event);

  res
    .status(201)
    .json(new ApiResponse(201, event, "Event created successfully"));
});

// ── GET /api/v1/events/:id ────────────────────────────────────────────────────
export const getEventById = asyncHandler(async (req, res) => {
  const event = await Event.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  })
    .populate("assignedTo", "name email")
    .populate("createdBy", "name email")
    .populate("doneBy", "name email");

  if (!event) throw new ApiError(404, "Event not found");

  res.status(200).json(new ApiResponse(200, event, "Event fetched"));
});

// ── PATCH /api/v1/events/:id ──────────────────────────────────────────────────
export const updateEvent = asyncHandler(async (req, res) => {
  const { title, eventDate, eventTime, note, assignedTo } = req.body;

  // 1. Create an update object to handle conditional fields
  const updateData = {
    ...(title && { title: title.trim() }),
    ...(eventDate && { eventDate }),
    ...(eventTime && { eventTime }),
    ...(note !== undefined && { note: note.trim() }),
  };

  // 2. Change: Add validation for assignedTo array
  if (assignedTo !== undefined) {
    // Ensure it's an array and not empty
    if (!Array.isArray(assignedTo) || assignedTo.length === 0) {
      throw new ApiError(400, "At least one assigned user is required");
    }
    updateData.assignedTo = assignedTo;
  }

  const event = await Event.findOneAndUpdate(
    {
      _id: req.params.id,
      organization: req.user.organization,
    },
    updateData, // Use the prepared update object
    { new: true, runValidators: true },
  )
    .populate("assignedTo", "name email")
    .populate("createdBy", "name email")
    .populate("doneBy", "name email");

  if (!event) throw new ApiError(404, "Event not found");

  await syncEventToGoogleCalendars(event);

  res.status(200).json(new ApiResponse(200, event, "Event updated"));
});

// ── PATCH /api/v1/events/:id/done ────────────────────────────────────────────
export const markEventDone = asyncHandler(async (req, res) => {
  const { isDone } = req.body;
  const newStatus = isDone !== undefined ? Boolean(isDone) : true;

  const event = await Event.findOneAndUpdate(
    { _id: req.params.id, organization: req.user.organization },
    {
      isDone: newStatus,
      doneBy: newStatus ? req.user._id : null,
      doneAt: newStatus ? new Date() : null,
    },
    { new: true },
  )
    .populate("assignedTo", "name email")
    .populate("doneBy", "name email");

  if (!event) throw new ApiError(404, "Event not found");

  await syncEventToGoogleCalendars(event);

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        event,
        event.isDone ? "Event marked as done" : "Event marked as pending",
      ),
    );
});

// ── DELETE /api/v1/events/:id ─────────────────────────────────────────────────
export const deleteEvent = asyncHandler(async (req, res) => {
  const event = await Event.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!event) throw new ApiError(404, "Event not found");

  await deleteEventFromGoogleCalendars(event);
  await Event.findByIdAndDelete(event._id);

  res.status(200).json(new ApiResponse(200, {}, "Event deleted"));
});
