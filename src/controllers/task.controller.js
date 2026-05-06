import Task from "../models/Task.model.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";

// GET /api/v1/tasks?leadId=xxx
export const getTasks = asyncHandler(async (req, res) => {
  const { leadId } = req.query;
  if (!leadId) throw new ApiError(400, "leadId required");

  const tasks = await Task.find({ leadId, organization: req.user.organization })
    .populate("createdBy", "name email")
    .populate("assignedTo", "name email")
    .sort({ createdAt: -1 });

  res.status(200).json(new ApiResponse(200, tasks, "Tasks fetched"));
});

// POST /api/v1/tasks
export const createTask = asyncHandler(async (req, res) => {
  const { leadId, title, dueDate, assignedTo } = req.body;
  if (!leadId || !title?.trim()) throw new ApiError(400, "leadId and title required");

  const task = await Task.create({
    leadId,
    title: title.trim(),
    dueDate: dueDate || null,
    assignedTo: assignedTo || null,
    createdBy: req.user._id,
    organization: req.user.organization,
  });

  const populated = await task.populate("createdBy", "name email");
  res.status(201).json(new ApiResponse(201, populated, "Task created"));
});

// PUT /api/v1/tasks/:taskId/complete
export const completeTask = asyncHandler(async (req, res) => {
  const { taskId } = req.params;

  const task = await Task.findOneAndUpdate(
    { _id: taskId, organization: req.user.organization },
    { isCompleted: true, completedAt: new Date() },
    { new: true }
  );

  if (!task) throw new ApiError(404, "Task not found");
  res.status(200).json(new ApiResponse(200, task, "Task completed"));
});

// DELETE /api/v1/tasks/:taskId
export const deleteTask = asyncHandler(async (req, res) => {
  const { taskId } = req.params;
  const task = await Task.findOneAndDelete({
    _id: taskId,
    organization: req.user.organization,
  });
  if (!task) throw new ApiError(404, "Task not found");
  res.status(200).json(new ApiResponse(200, { taskId }, "Task deleted"));
});