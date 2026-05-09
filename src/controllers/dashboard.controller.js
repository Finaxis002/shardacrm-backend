import Lead from "../models/Lead.model.js";
import Payment from "../models/Payment.model.js";
import Reminder from "../models/Reminder.model.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";

export const getDashboardOverview = asyncHandler(async (req, res) => {
  const organization = req.user.organization;
  const userId = req.user._id;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [
    totalLeads,
    activeLeads,
    wonLeads,
    pipelineLeads,
    pipelineValueResult,
    collectedResult,
  ] = await Promise.all([
    Lead.countDocuments({ organization }),
    Lead.countDocuments({ organization, isActive: true }),
    Lead.countDocuments({ organization, status: "Success" }),
    Lead.countDocuments({
      organization,
      status: { $nin: ["Success", "Closed"] },
    }),
    Lead.aggregate([
      {
        $match: {
          organization,
          status: { $nin: ["Success", "Closed"] },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$dealValue" },
        },
      },
    ]),
    Payment.aggregate([
      {
        $match: {
          organization,
          status: { $in: ["Paid", "Partial", "Overdue"] },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
        },
      },
    ]),
  ]);

  const pipelineValue = pipelineValueResult[0]?.total || 0;
  const collectedAmount = collectedResult[0]?.total || 0;
const leadFilter = {
  organization,
  $or: [
    { assignedTo: userId },
    { coAssignees: userId },
  ],
};
  const [recentLeads, todayReminders, teamPerformance] = await Promise.all([
    Lead.find(leadFilter)
  .sort({ createdAt: -1 })
  .limit(5)
  .populate("assignedTo", "name")
  .lean(),
   Reminder.find({
  organization,
  isDone: false,
  reminderDate: { $gte: today, $lt: tomorrow },
 $or: [{ assignedTo: userId }, { notifyUsers: userId }], 
})
      .populate("leadId", "name phone")
      .sort({ reminderTime: 1 })
      .lean(),
    Lead.aggregate([
      { $match: { organization } },
      {
        $group: {
          _id: "$assignedTo",
          leadCount: { $sum: 1 },
          totalDealValue: { $sum: "$dealValue" },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      {
        $unwind: {
          path: "$user",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          userId: "$_id",
          name: { $ifNull: ["$user.name", "Unassigned"] },
          leadCount: 1,
          totalDealValue: 1,
        },
      },
      { $sort: { leadCount: -1, totalDealValue: -1 } },
      { $limit: 5 },
    ]),
  ]);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        totalLeads,
        activeLeads,
        wonLeads,
        pipelineLeads,
        pipelineValue,
        collectedAmount,
        todayRemindersCount: todayReminders.length,
        todayReminders,
        recentLeads,
        teamPerformance,
      },
      "Dashboard overview fetched successfully",
    ),
  );
});
