import Lead from "../models/Lead.model.js";
import User from "../models/User.model.js";
import Payment from "../models/Payment.model.js";
import Reminder from "../models/Reminder.model.js";
import Event from "../models/Event.model.js";
import Activity from "../models/Activity.model.js";
import Settings from "../models/Settings.model.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { canUser } from "../utils/permissions.js";

export const getDashboardOverview = asyncHandler(async (req, res) => {
  const organization = req.user.organization;
  const userId = req.user._id;

  const canViewAll = await canUser(req.user, organization, "view_all_leads");
  const isAdmin = req.user.role === "admin";
  const isManager = req.user.role === "manager";

  const { filter } = req.query;
  const now = new Date();

  const getISTMidnight = (date) => {
    const dateStr = date.toLocaleDateString("en-CA", {
      timeZone: "Asia/Kolkata",
    });
    return new Date(`${dateStr}T00:00:00+05:30`);
  };

  const getEndOfDay = (date) =>
    new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1);

  const getWeekStart = (date) => {
    const day = date.getDay();
    const diffToMonday = day === 0 ? 6 : day - 1;
    return new Date(date.getTime() - diffToMonday * 24 * 60 * 60 * 1000);
  };

  let rangeStart = null;
  let rangeEnd = null;

  if (filter === "week") {
    const todayIST = getISTMidnight(now);
    rangeStart = getWeekStart(todayIST);
    rangeEnd = getEndOfDay(todayIST);
  } else if (filter === "month") {
    const todayIST = getISTMidnight(now);
    rangeStart = new Date(
      `${todayIST.getFullYear()}-${String(todayIST.getMonth() + 1).padStart(
        2,
        "0",
      )}-01T00:00:00+05:30`,
    );
    rangeEnd = getEndOfDay(todayIST);
  } else if (filter === "today") {
    const todayIST = getISTMidnight(now);
    rangeStart = todayIST;
    rangeEnd = getEndOfDay(todayIST);
  }

  let subordinateIds = [];
  if (isManager) {
    const subordinates = await User.find({ managerId: userId, organization })
      .select("_id")
      .lean();
    subordinateIds = subordinates.map((u) => u._id);
  }

  const allowedIds = isManager ? [userId, ...subordinateIds] : [];

  const viewTeamOnly = await canUser(
    req.user,
    organization,
    "view_team_leads_only",
  );

  const dateFilter = rangeStart
    ? { createdAt: { $gte: rangeStart, $lte: rangeEnd } }
    : {};
  const statusDateFilter = rangeStart
    ? { updatedAt: { $gte: rangeStart, $lte: rangeEnd } }
    : {};

  const statsFilterBase = isAdmin
    ? { organization }
    : isManager && canViewAll
      ? { organization }
      : isManager && viewTeamOnly
        ? {
            organization,
            $or: [
              { assignedTo: { $in: allowedIds } },
              { coAssignees: { $in: allowedIds } },
            ],
          }
        : canViewAll
          ? { organization }
          : {
              organization,
              $or: [{ assignedTo: userId }, { coAssignees: userId }],
            };

  const wonClosedFilter = { ...statsFilterBase, ...statusDateFilter };

  const statsFilter = isAdmin
    ? { organization, ...dateFilter }
    : isManager && canViewAll
      ? { organization, ...dateFilter }
      : isManager && viewTeamOnly
        ? {
            organization,
            ...dateFilter,
            $or: [
              { assignedTo: { $in: allowedIds } },
              { coAssignees: { $in: allowedIds } },
            ],
          }
        : canViewAll
          ? { organization, ...dateFilter }
          : {
              organization,
              ...dateFilter,
              $or: [{ assignedTo: userId }, { coAssignees: userId }],
            };

  const attributionFilter = isAdmin
    ? { organization, ...dateFilter }
    : isManager && canViewAll
      ? { organization, ...dateFilter }
      : isManager && viewTeamOnly
        ? {
            organization,
            ...dateFilter,
            $or: [
              { assignedTo: { $in: allowedIds } },
              { coAssignees: { $in: allowedIds } },
            ],
          }
        : canViewAll
          ? { organization, ...dateFilter }
          : {
              organization,
              ...dateFilter,
              $or: [{ assignedTo: userId }, { coAssignees: userId }],
            };

  const attributionFilterAllTime = isAdmin
    ? { organization }
    : isManager && canViewAll
      ? { organization }
      : isManager && viewTeamOnly
        ? {
            organization,
            $or: [
              { assignedTo: { $in: allowedIds } },
              { coAssignees: { $in: allowedIds } },
            ],
          }
        : canViewAll
          ? { organization }
          : {
              organization,
              $or: [{ assignedTo: userId }, { coAssignees: userId }],
            };

  const attributionLeadsAllTime = await Lead.find(attributionFilterAllTime)
    .select("_id")
    .lean();
  const attributionLeadIdsAllTime = attributionLeadsAllTime.map((l) => l._id);

  const todayStartIST = getISTMidnight(now);
  const tomorrowStartIST = new Date(
    todayStartIST.getTime() + 24 * 60 * 60 * 1000,
  );
  const todayString = todayStartIST.toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });

  const exclusionStatuses = ["Success", "Closed"];

  const attributionLeads = await Lead.find(attributionFilter)
    .select("_id")
    .lean();
  const attributionLeadIds = attributionLeads.map((l) => l._id);

  const [
    totalLeads,
    activeLeads,
    wonLeads,
    closedLeads,
    pipelineValueResult,
    collectedResult,
  ] = await Promise.all([
    Lead.countDocuments(statsFilter),
    Lead.countDocuments({
      ...statsFilter,
      status: { $nin: exclusionStatuses },
    }),
    Lead.countDocuments({ ...wonClosedFilter, status: "Success" }),
    Lead.countDocuments({ ...wonClosedFilter, status: "Closed" }),
    Lead.aggregate([
      { $match: { ...attributionFilter, status: { $nin: exclusionStatuses } } },
      { $group: { _id: null, total: { $sum: "$dealValue" } } },
    ]),
    Payment.aggregate([
      {
        $match: {
          organization,
          leadId: { $in: attributionLeadIdsAllTime },
          ...(rangeStart
            ? { paymentDate: { $gte: rangeStart, $lte: rangeEnd } }
            : {}),
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  // ✅ ADD: todayEvents and todayTasks in second Promise.all
  const [
    recentLeads,
    todayReminders,
    todayEvents,
    todayTasks,
    teamPerformance,
  ] = await Promise.all([
    Lead.find(statsFilter)
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("assignedTo", "name")
      .lean(),

    Reminder.find({
      organization,
      isDone: false,
      reminderDate: { $gte: todayStartIST, $lt: tomorrowStartIST },
      $or: [{ assignedTo: userId }, { notifyUsers: userId }],
    })
      .populate("leadId", "name phone")
      .sort({ reminderTime: 1 })
      .lean(),

    // ✅ NEW
    Event.find({
      organization,
      isDone: false,
      eventDate: todayString,
      assignedTo: userId,
    })
      .populate("assignedTo", "name email")
      .sort({ eventTime: 1 })
      .lean(),

    // ✅ NEW
    Activity.find({
      organization,
      type: "Task",
      taskCompleted: false,
      taskDueDate: { $gte: todayStartIST, $lt: tomorrowStartIST },
      taskAssignedTo: userId,
    })
      .populate("taskAssignedTo", "name email")
      .populate("leadId", "name phone")
      .sort({ taskDueDate: 1 })
      .lean(),

    Lead.aggregate([
      { $match: statsFilter },
      {
        $group: {
          _id: "$assignedTo",
          leadCount: { $sum: 1 },
          totalDealValue: { $sum: { $ifNull: ["$dealValue", 0] } },
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
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
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
        closedLeads,
        pipelineValue: pipelineValueResult[0]?.total || 0,
        collectedAmount: collectedResult[0]?.total || 0,
        todayRemindersCount: todayReminders.length,
        todayReminders,
        todayEvents, // ✅ NEW
        todayTasks, // ✅ NEW
        recentLeads,
        teamPerformance,
      },
      "Dashboard overview fetched successfully",
    ),
  );
});
