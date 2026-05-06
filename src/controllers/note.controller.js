import Note from "../models/Note.model.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";

// GET /api/v1/notes?leadId=xxx
export const getNotes = asyncHandler(async (req, res) => {
  const { leadId } = req.query;
  if (!leadId) throw new ApiError(400, "leadId required");

  const notes = await Note.find({ leadId, organization: req.user.organization })
    .populate("createdBy", "name email")
    .sort({ createdAt: -1 });

  res.status(200).json(new ApiResponse(200, notes, "Notes fetched"));
});

// POST /api/v1/notes
export const createNote = asyncHandler(async (req, res) => {
  const { leadId, text } = req.body;
  if (!leadId || !text?.trim()) throw new ApiError(400, "leadId and text required");

  const note = await Note.create({
    leadId,
    text: text.trim(),
    createdBy: req.user._id,
    organization: req.user.organization,
  });

  const populated = await note.populate("createdBy", "name email");
  res.status(201).json(new ApiResponse(201, populated, "Note created"));
});

// PUT /api/v1/notes/:noteId
export const updateNote = asyncHandler(async (req, res) => {
  const { noteId } = req.params;
  const { text } = req.body;
  if (!text?.trim()) throw new ApiError(400, "text required");

  const note = await Note.findOneAndUpdate(
    { _id: noteId, organization: req.user.organization },
    { text: text.trim() },
    { new: true }
  ).populate("createdBy", "name email");

  if (!note) throw new ApiError(404, "Note not found");
  res.status(200).json(new ApiResponse(200, note, "Note updated"));
});

// DELETE /api/v1/notes/:noteId
export const deleteNote = asyncHandler(async (req, res) => {
  const { noteId } = req.params;
  const note = await Note.findOneAndDelete({
    _id: noteId,
    organization: req.user.organization,
  });
  if (!note) throw new ApiError(404, "Note not found");
  res.status(200).json(new ApiResponse(200, { noteId }, "Note deleted"));
});