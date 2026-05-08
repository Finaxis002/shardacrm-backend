import Event from "../models/Event.model.js";
import ApiResponse from "../utils/apiResponse.js";
import ApiError from "../utils/apiError.js";
import asyncHandler from "../utils/asyncHandler.js";

// ── GET /api/v1/events ────────────────────────────────────────────────────────
export const getEvents = asyncHandler(async (req, res) => {
  const { limit = 100, page = 1, assignedTo } = req.query;

  const filter = { organization: req.user.organization };
if (assignedTo) {
  filter.assignedTo = assignedTo; 
}

  const [data, total] = await Promise.all([
    Event.find(filter)
      .sort({ eventDate: 1, eventTime: 1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .populate("assignedTo", "name email")
      .populate("createdBy",  "name email")
      .populate("doneBy",     "name email"),
    Event.countDocuments(filter),
  ]);

  res.status(200).json(
    new ApiResponse(200, { data, total, page: Number(page), limit: Number(limit) }, "Events fetched"),
  );
});

// ── POST /api/v1/events ───────────────────────────────────────────────────────
export const createEvent = asyncHandler(async (req, res) => {
  const { title, eventDate, eventTime, note, assignedTo } = req.body;

  if (!title?.trim()) throw new ApiError(400, "Event title is required");
  if (!eventDate)     throw new ApiError(400, "Event date is required");
 if (!Array.isArray(assignedTo) || assignedTo.length === 0) {
    throw new ApiError(400, "At least one assigned user is required");
  }

  const event = await Event.create({
    title:        title.trim(),
    eventDate,
    eventTime:    eventTime || "10:00",
    note:         note?.trim() || "",
    assignedTo,
    organization: req.user.organization,
    createdBy:    req.user._id,
  });

  // Populate before returning so frontend gets name/email directly
  await event.populate("assignedTo", "name email");
  await event.populate("createdBy",  "name email");

  res.status(201).json(new ApiResponse(201, event, "Event created successfully"));
});

// ── GET /api/v1/events/:id ────────────────────────────────────────────────────
export const getEventById = asyncHandler(async (req, res) => {
  const event = await Event.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  })
    .populate("assignedTo", "name email")
    .populate("createdBy",  "name email")
    .populate("doneBy",     "name email");

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
      organization: req.user.organization 
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
      isDone:  newStatus,
      doneBy:  newStatus ? req.user._id : null,
      doneAt:  newStatus ? new Date()   : null,
    },
    { new: true },
  ).populate("assignedTo", "name email").populate("doneBy", "name email");

  if (!event) throw new ApiError(404, "Event not found");

  res.status(200).json(
    new ApiResponse(200, event, event.isDone ? "Event marked as done" : "Event marked as pending"),
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