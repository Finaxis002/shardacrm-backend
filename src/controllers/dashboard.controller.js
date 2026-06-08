import Lead from "../models/Lead.model.js";
import User from "../models/User.model.js";
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
  const isAdmin = req.user.role === "admin";
  const isManager = req.user.role === "manager";

    const { filter } = req.query;
const now = new Date();
let rangeStart = new Date();
let rangeEnd = new Date();
rangeEnd.setHours(23, 59, 59, 999);

if (filter === "week") {
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const todayIST = new Date(todayStr + "T00:00:00+05:30");
  const day = todayIST.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  rangeStart = new Date(todayIST.getTime() - diffToMonday * 24 * 60 * 60 * 1000);
  rangeEnd = new Date(todayIST.getTime() + 24 * 60 * 60 * 1000 - 1);
} else if (filter === "month") {
  const istStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const [year, month] = istStr.split("-").map(Number);
  rangeStart = new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00+05:30`);
  rangeEnd = new Date(now.toLocaleString("en-CA", { timeZone: "Asia/Kolkata" }).split(",")[0] + "T23:59:59+05:30");
} else if (filter === "today") {
  const todayIST = new Date(now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) + "T00:00:00+05:30");
  rangeStart = todayIST;
  rangeEnd = new Date(todayIST.getTime() + 24 * 60 * 60 * 1000 - 1);
} else {
  rangeStart = null;
  rangeEnd = null;
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

const dateFilter = rangeStart ? { createdAt: { $gte: rangeStart, $lte: rangeEnd } } : {};
const statusDateFilter = rangeStart 
  ? { updatedAt: { $gte: rangeStart, $lte: rangeEnd } } 
  : {};

  const statsFilterBase = isAdmin
  ? { organization }
  : isManager && canViewAll
    ? { organization }
    : isManager && viewTeamOnly
      ? { organization, $or: [{ assignedTo: { $in: allowedIds } }, { coAssignees: { $in: allowedIds } }] }
      : canViewAll
        ? { organization }
        : { organization, $or: [{ assignedTo: userId }, { coAssignees: userId }] };

const wonClosedFilter = { ...statsFilterBase, ...statusDateFilter };

  // Filter for VISIBILITY (Includes Co-Assignees) - Used for lists and counts
  const statsFilter = isAdmin
     ? { organization, ...dateFilter }     
    : isManager && canViewAll
      ? { organization, ...dateFilter } 
      : isManager && viewTeamOnly
        ? {
            organization, ...dateFilter, 
            $or: [
              { assignedTo: { $in: allowedIds } },
              { coAssignees: { $in: allowedIds } },
            ],
          }
        : canViewAll
          ? { organization, ...dateFilter }
          : {
              organization, ...dateFilter, 
              $or: [{ assignedTo: userId }, { coAssignees: userId }],
            };

  // Filter for ATTRIBUTION (Strictly Primary Owner) - Used for monetary stats
  const attributionFilter = isAdmin
    ? { organization, ...dateFilter }   
    : isManager && canViewAll
      ? { organization, ...dateFilter }     
      : isManager && viewTeamOnly
        ? {
            organization, ...dateFilter,
            assignedTo: { $in: allowedIds },
          }
        : canViewAll
          ? { organization, ...dateFilter }   
          : {
              organization, ...dateFilter, 
              assignedTo: userId,
            };
const attributionFilterAllTime = isAdmin
  ? { organization }
  : isManager && canViewAll
    ? { organization }
    : isManager && viewTeamOnly
      ? { organization, assignedTo: { $in: allowedIds } }
      : canViewAll
        ? { organization }
        : { organization, assignedTo: userId };

// All-time lead IDs (date filter nahi)
const attributionLeadsAllTime = await Lead.find(attributionFilterAllTime)
  .select("_id")
  .lean();
const attributionLeadIdsAllTime = attributionLeadsAllTime.map((l) => l._id);


  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const exclusionStatuses = ["Success", "Closed"];

  // Fetch ONLY owned lead IDs for strict payment attribution
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
    // Counts use the general visibility filter
    Lead.countDocuments(statsFilter),

    Lead.countDocuments({
      ...statsFilter,
      status: { $nin: exclusionStatuses },
    }),

Lead.countDocuments({ ...wonClosedFilter, status: "Success" }),
Lead.countDocuments({ ...wonClosedFilter, status: "Closed" }),

    // Monetary values use the strict attribution filter to avoid duplicate counting
    Lead.aggregate([
      { $match: { ...attributionFilter, status: { $nin: exclusionStatuses } } },
      { $group: { _id: null, total: { $sum: "$dealValue" } } },
    ]),

Payment.aggregate([
  {
    $match: {
      organization,
      leadId: { $in: attributionLeadIdsAllTime },
      // status: "Paid",
      ...(rangeStart ? {
        paymentDate: { $gte: rangeStart, $lte: rangeEnd } 
      } : {}),
    },
  },
  { $group: { _id: null, total: { $sum: "$amount" } } },
]),
  ]);

  const [recentLeads, todayReminders, teamPerformance] = await Promise.all([
    Lead.find(statsFilter)
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
// ═══════════════════════════════════════════════════════════════
  // 🔍 DATA VERIFICATION MONITOR LOGS
  // ═══════════════════════════════════════════════════════════════
//   console.log("------------------------------------");
//   console.log(`📈 METRICS FOR FILTER PROFILE: [${filter?.toUpperCase() || "TODAY"}]`);
//   console.log(`🔹 Total Leads Found     : ${totalLeads}`);
//   console.log(`🔹 Active Leads Found    : ${activeLeads}`);
//   console.log(`🔹 Won/Success Leads     : ${wonLeads}`);
//   console.log(`🔹 Closed Leads Found    : ${closedLeads}`);
//   console.log(`💰 Total Pipeline Value  : ₹${pipelineValueResult[0]?.total || 0}`);
//   console.log(`💳 Collected Payments    : ₹${collectedResult[0]?.total || 0}`);
//   console.log("------------------------------------");
//   console.log("rangeStart:", rangeStart);
// console.log("rangeEnd:", rangeEnd);
  
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
        recentLeads,
        teamPerformance,
      },
      "Dashboard overview fetched successfully",
    ),
  );
});
