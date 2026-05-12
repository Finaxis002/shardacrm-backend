import Lead from "../models/Lead.model.js";
import Payment from "../models/Payment.model.js";
import Reminder from "../models/Reminder.model.js";
import Settings from "../models/Settings.model.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { canUser } from "../utils/permissions.js";

export const getDashboardOverview = asyncHandler(async (req, res) => {
  const organization = req.user.organization;
  const userId = req.user._id;

  const canViewAll = await canUser(req.user, organization, "view_all_leads");

  // ✅ Agar permission hai → saari leads, nahi hai → sirf assigned
  const statsFilter = canViewAll
    ? { organization }
    : { organization, $or: [{ assignedTo: userId }, { coAssignees: userId }] };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [
    totalLeads, activeLeads, wonLeads, pipelineLeads,
    pipelineValueResult, collectedResult,
  ] = await Promise.all([
    Lead.countDocuments(statsFilter),
    Lead.countDocuments({ ...statsFilter, isActive: true }),
    Lead.countDocuments({ ...statsFilter, status: "Success" }),
    Lead.countDocuments({ ...statsFilter, status: { $nin: ["Success", "Closed"] } }),
    Lead.aggregate([
      { $match: { ...statsFilter, status: { $nin: ["Success", "Closed"] } } },
      { $group: { _id: null, total: { $sum: "$dealValue" } } },
    ]),
    Payment.aggregate([
      { $match: { organization } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  const [recentLeads, todayReminders, teamPerformance] = await Promise.all([
    Lead.find({ organization, $or: [{ assignedTo: userId }, { coAssignees: userId }] })
      .sort({ createdAt: -1 }).limit(5).populate("assignedTo", "name").lean(),

    Reminder.find({
      organization, isDone: false,
      reminderDate: { $gte: today, $lt: tomorrow },
      $or: [{ assignedTo: userId }, { notifyUsers: userId }],
    }).populate("leadId", "name phone").sort({ reminderTime: 1 }).lean(),

    // Team performance — canViewAll ho toh saari leads ka breakdown
    Lead.aggregate([
      { $match: canViewAll ? { organization } : { organization, $or: [{ assignedTo: userId }, { coAssignees: userId }] } },
      { $group: { _id: "$assignedTo", leadCount: { $sum: 1 }, totalDealValue: { $sum: { $ifNull: ["$dealValue", 0] } } } },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
      { $project: { userId: "$_id", name: { $ifNull: ["$user.name", "Unassigned"] }, leadCount: 1, totalDealValue: 1 } },
      { $sort: { leadCount: -1, totalDealValue: -1 } },
      { $limit: 5 },
    ]),
  ]);

  res.status(200).json(new ApiResponse(200, {
    totalLeads,
    activeLeads,
    wonLeads,
    pipelineLeads,
    pipelineValue:    pipelineValueResult[0]?.total || 0,
    collectedAmount:  collectedResult[0]?.total || 0,
    todayRemindersCount: todayReminders.length,
    todayReminders,
    recentLeads,
    teamPerformance,
  }, "Dashboard overview fetched successfully"));
});