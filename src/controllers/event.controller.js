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

const createGcalEventForUser = async ({
  userId,
  title,
  note,
  eventDate,
  eventTime,
  timezone,
  assignedToIds,
  createdById,
  eventId,
}) => {
  try {
    const client = await getUserGcalClient(userId);
    if (!client) return null;

    const start = new Date(`${eventDate}T${eventTime || "10:00"}:00`);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const description = [
      note ? `Note: ${note}` : "",
      `Assigned To: ${assignedToIds.join(", ")}`,
      `Created By: ${createdById}`,
    ]
      .filter(Boolean)
      .join("\n");

    const calendar = google.calendar({ version: "v3", auth: client });
    const { data } = await calendar.events.insert({
      calendarId: "primary",
      resource: {
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
      },
    });

    return data.id;
  } catch (err) {
    return null;
  }
};

const syncEventToGoogleCalendars = async (eventDoc) => {
  const assignedToIds = eventDoc.assignedTo.map((item) =>
    item?._id ? String(item._id) : String(item),
  );
  if (!assignedToIds.length) return;

  const settings = await Settings.findOne({
    organization: eventDoc.organization,
  });
  const timezone = settings?.timezone || "Asia/Kolkata";
  const createdById = eventDoc.createdBy?._id
    ? String(eventDoc.createdBy._id)
    : String(eventDoc.createdBy);
  const eventId = String(eventDoc._id);

  await Promise.allSettled(
    assignedToIds.map((userId) =>
      createGcalEventForUser({
        userId,
        title: eventDoc.title,
        note: eventDoc.note,
        eventDate: eventDoc.eventDate,
        eventTime: eventDoc.eventTime,
        timezone,
        assignedToIds,
        createdById,
        eventId,
      }),
    ),
  );
};

// ── GET /api/v1/events ────────────────────────────────────────────────────────
export const getEvents = asyncHandler(async (req, res) => {
  const { limit = 100, page = 1, assignedTo } = req.query;

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

  const [data, total] = await Promise.all([
    Event.find(filter)
      .sort({ eventDate: 1, eventTime: 1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .populate("assignedTo", "name email")
      .populate("createdBy", "name email")
      .populate("doneBy", "name email"),
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
  const event = await Event.findOneAndDelete({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!event) throw new ApiError(404, "Event not found");

  res.status(200).json(new ApiResponse(200, {}, "Event deleted"));
});
