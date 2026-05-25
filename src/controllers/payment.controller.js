import Payment from "../models/Payment.model.js";
import Lead from "../models/Lead.model.js";
import User from "../models/User.model.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { formatPaginatedResponse, parsePagination } from "../utils/paginate.js";
import logger from "../utils/logger.js";
import { canUser } from "../utils/permissions.js";

const buildVisibilityFilter = async (user, organization, targetUserId) => {
  const isAdmin = user.role === "admin";
  const canViewAll =
    isAdmin || (await canUser(user, organization, "view_all_leads"));
  const canViewTeam = await canUser(user, organization, "view_team_leads_only");

  // ─── CASE 1: Admin/Manager filtered by specific user ───────────────
  if (
    targetUserId &&
    (canViewAll || (user.role === "manager" && canViewTeam))
  ) {
    // Manager can only filter their team
    if (user.role === "manager" && !canViewAll) {
      const teamMembers = await User.find({
        managerId: user._id,
        organization,
      })
        .select("_id")
        .lean();
      const teamIds = teamMembers.map((u) => String(u._id));
      teamIds.push(String(user._id));

      if (!teamIds.includes(String(targetUserId))) {
        return { mode: "none" };
      }
    }

    // All leads for target user (Owner + Co-assignee)
    const targetUserLeads = await Lead.find({
      organization,
      $or: [{ assignedTo: targetUserId }, { coAssignees: targetUserId }],
    })
      .select("_id")
      .lean();

    return {
      mode: "filtered",
      leadIds: targetUserLeads.map((l) => l._id),
      userIds: [targetUserId],
    };
  }

  // ─── CASE 2: Admin / Full Access (no filter) ───────────────────────
  if (canViewAll) {
    return { mode: "all" };
  }

  // ─── CASE 3: Manager with team-only view ───────────────────────────
  if (user.role === "manager" && canViewTeam) {
    const teamMembers = await User.find({
      managerId: user._id,
      organization,
    })
      .select("_id")
      .lean();
    const teamIds = [user._id, ...teamMembers.map((u) => u._id)];

    const teamLeads = await Lead.find({
      organization,
      $or: [
        { assignedTo: { $in: teamIds } },
        { coAssignees: { $in: teamIds } },
      ],
    })
      .select("_id")
      .lean();

    return {
      mode: "team",
      leadIds: teamLeads.map((l) => l._id),
      userIds: teamIds,
    };
  }

  // ─── CASE 4: Regular Sales User ────────────────────────────────────
  // Owner + Co-assignee + RecordedBy → all should be visible
  const myLeads = await Lead.find({
    organization,
    $or: [{ assignedTo: user._id }, { coAssignees: user._id }],
  })
    .select("_id")
    .lean();

  return {
    mode: "self",
    leadIds: myLeads.map((l) => l._id),
    userIds: [user._id],
  };
};

/* ═══════════════════════════════════════════════════════════════════════════
   HELPER 2: ATTRIBUTION FILTER
   ─────────────────────────────────────────────────────────────────────────
   Purpose: "Whose credit will be counted" (for stats)
   Includes: ONLY Lead Owner (assignedTo) — NOT Co-assignee
   Reason: To avoid duplicate counting
═══════════════════════════════════════════════════════════════════════════ */
const buildAttributionFilter = async (user, organization, targetUserId) => {
  const isAdmin = user.role === "admin";
  const canViewAll =
    isAdmin || (await canUser(user, organization, "view_all_leads"));
  const canViewTeam = await canUser(user, organization, "view_team_leads_only");

  // ─── CASE 1: Admin/Manager filtered by specific user ───────────────
  if (
    targetUserId &&
    (canViewAll || (user.role === "manager" && canViewTeam))
  ) {
    if (user.role === "manager" && !canViewAll) {
      const teamMembers = await User.find({
        managerId: user._id,
        organization,
      })
        .select("_id")
        .lean();
      const teamIds = teamMembers.map((u) => String(u._id));
      teamIds.push(String(user._id));

      if (!teamIds.includes(String(targetUserId))) {
        return { mode: "none" };
      }
    }

    //  ONLY assignedTo (Owner) - NOT coAssignees
    const leads = await Lead.find({
      organization,
      assignedTo: targetUserId,
    })
      .select("_id")
      .lean();

    return { mode: "filtered", leadIds: leads.map((l) => l._id) };
  }

  // ─── CASE 2: Admin / Full access ───────────────────────────────────
  if (canViewAll) {
    return { mode: "all" };
  }

  // ─── CASE 3: Manager - team's owned leads only ─────────────────────
  if (user.role === "manager" && canViewTeam) {
    const teamMembers = await User.find({
      managerId: user._id,
      organization,
    })
      .select("_id")
      .lean();
    const teamIds = [user._id, ...teamMembers.map((u) => u._id)];

    //  ONLY assignedTo (team members should be owners)
    const leads = await Lead.find({
      organization,
      assignedTo: { $in: teamIds },
    })
      .select("_id")
      .lean();

    return { mode: "team", leadIds: leads.map((l) => l._id) };
  }

  // ─── CASE 4: Regular User - ONLY their owned leads ──────────────────
  const myLeads = await Lead.find({
    organization,
    assignedTo: user._id, // Only leads where I am the owner
  })
    .select("_id")
    .lean();

  return { mode: "self", leadIds: myLeads.map((l) => l._id) };
};

/* ═══════════════════════════════════════════════════════════════════════════
   APPLY FILTERS
═══════════════════════════════════════════════════════════════════════════ */

// For LIST (visibility - includes recordedBy)
const applyVisibilityFilter = (filter, accessFilter) => {
  if (accessFilter.mode === "all") return filter;

  if (accessFilter.mode === "none") {
    filter._id = null;
    return filter;
  }

  const conditions = [];
  if (accessFilter.leadIds?.length) {
    conditions.push({ leadId: { $in: accessFilter.leadIds } });
  }
  if (accessFilter.userIds?.length) {
    conditions.push({ recordedBy: { $in: accessFilter.userIds } });
  }

  if (conditions.length === 0) {
    filter._id = null;
    return filter;
  }

  if (filter.$or) {
    filter.$and = [{ $or: filter.$or }, { $or: conditions }];
    delete filter.$or;
  } else {
    filter.$or = conditions;
  }

  return filter;
};

// For STATS (attribution - ONLY leadId match, NO recordedBy)
const applyAttributionFilter = (filter, accessFilter) => {
  if (accessFilter.mode === "all") return filter;

  if (accessFilter.mode === "none") {
    filter._id = null;
    return filter;
  }

  if (accessFilter.leadIds?.length) {
    filter.leadId = { $in: accessFilter.leadIds };
  } else {
    filter._id = null;
  }

  return filter;
};

/* ═══════════════════════════════════════════════════════════════════════════
   GET ALL PAYMENTS
   @route GET /api/v1/payments
═══════════════════════════════════════════════════════════════════════════ */
export const getPayments = asyncHandler(async (req, res) => {
  const { page, limit, status, leadId, userId: targetUserId } = req.query;
  const organization = req.user.organization;

  let filter = { organization };
  if (status) filter.status = status;
  if (leadId) filter.leadId = leadId;

  const accessFilter = await buildVisibilityFilter(
    req.user,
    organization,
    targetUserId,
  );

  filter = applyVisibilityFilter(filter, accessFilter);

  const {
    skip,
    limit: pageLimit,
    page: pageNum,
  } = parsePagination({ page, limit });

  const [payments, total] = await Promise.all([
    Payment.find(filter)
      .skip(skip)
      .limit(pageLimit)
      .populate({
        path: "leadId",
        select: "name phone email assignedTo coAssignees",
        populate: [
          { path: "assignedTo", select: "name email" },
          { path: "coAssignees", select: "name email" },
        ],
      })
      .populate("recordedBy", "name email")
      .sort({ createdAt: -1 })
      .lean(),
    Payment.countDocuments(filter),
  ]);

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        formatPaginatedResponse(payments, total, pageNum, pageLimit),
        "Payments fetched successfully",
      ),
    );
});

/* ═══════════════════════════════════════════════════════════════════════════
   GET SINGLE PAYMENT
   @route GET /api/v1/payments/:id
═══════════════════════════════════════════════════════════════════════════ */
export const getPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const organization = req.user.organization;

  const payment = await Payment.findOne({ _id: id, organization })
    .populate({
      path: "leadId",
      select: "name phone email assignedTo coAssignees",
      populate: [
        { path: "assignedTo", select: "name email" },
        { path: "coAssignees", select: "name email" },
      ],
    })
    .populate("recordedBy", "name email")
    .lean();

  if (!payment) {
    throw new ApiError(404, "Payment not found");
  }

  res
    .status(200)
    .json(new ApiResponse(200, payment, "Payment fetched successfully"));
});

/* ═══════════════════════════════════════════════════════════════════════════
   RECORD PAYMENT
═══════════════════════════════════════════════════════════════════════════ */
export const recordPayment = asyncHandler(async (req, res) => {
  const {
    leadId,
    amount,
    currency = "INR",
    paymentMode,
    status = "Paid",
    reference,
    paymentDate,
    dueDate,
    description,
  } = req.body;

  const organization = req.user.organization;
  const recordedBy = req.user._id;

  const lead = await Lead.findOne({ _id: leadId, organization });
  if (!lead) {
    throw new ApiError(404, "Lead not found");
  }

  const payment = new Payment({
    leadId,
    amount,
    currency,
    paymentMode,
    status,
    reference,
    paymentDate: paymentDate || new Date(),
    dueDate,
    description,
    recordedBy,
    organization,
  });

  await payment.save();
  await payment.populate("leadId", "name phone");
  await payment.populate("recordedBy", "name email");

  logger.info(`Payment recorded: ${payment._id} for lead ${leadId}`);

  res
    .status(201)
    .json(new ApiResponse(201, payment, "Payment recorded successfully"));
});

/* ═══════════════════════════════════════════════════════════════════════════
   UPDATE PAYMENT
═══════════════════════════════════════════════════════════════════════════ */
export const updatePayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const organization = req.user.organization;

  const payment = await Payment.findOne({ _id: id, organization });
  if (!payment) {
    throw new ApiError(404, "Payment not found");
  }

  Object.assign(payment, req.body);
  await payment.save();
  await payment.populate("leadId", "name phone");
  await payment.populate("recordedBy", "name email");

  logger.info(`Payment updated: ${id}`);

  res
    .status(200)
    .json(new ApiResponse(200, payment, "Payment updated successfully"));
});

/* ═══════════════════════════════════════════════════════════════════════════
   DELETE PAYMENT
═══════════════════════════════════════════════════════════════════════════ */
export const deletePayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const organization = req.user.organization;

  const payment = await Payment.findOne({ _id: id, organization });
  if (!payment) {
    throw new ApiError(404, "Payment not found");
  }

  await Payment.findByIdAndDelete(id);

  logger.info(`Payment deleted: ${id}`);

  res
    .status(200)
    .json(new ApiResponse(200, null, "Payment deleted successfully"));
});

/* ═══════════════════════════════════════════════════════════════════════════
   GENERATE PAYMENT LINK
═══════════════════════════════════════════════════════════════════════════ */
export const generatePaymentLink = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { description } = req.body;
  const organization = req.user.organization;

  const payment = await Payment.findOne({ _id: id, organization });
  if (!payment) {
    throw new ApiError(404, "Payment not found");
  }

  const mockLink = `https://payment.example.com/link/${payment._id}`;

  payment.paymentLinkUrl = mockLink;
  payment.paymentLinkExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await payment.save();

  logger.info(`Payment link generated for payment ${id}`);

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { paymentLink: mockLink, expiryDate: payment.paymentLinkExpiry },
        "Payment link generated successfully",
      ),
    );
});

/* ═══════════════════════════════════════════════════════════════════════════
   GET PAYMENT STATISTICS (Attribution-based, NO duplicate count)
   @route GET /api/v1/payments/stats/overview
═══════════════════════════════════════════════════════════════════════════ */
export const getPaymentStats = asyncHandler(async (req, res) => {
  const { userId: targetUserId } = req.query;
  const organization = req.user.organization;

  let matchStage = { organization };

  // Use ATTRIBUTION filter (based only on Lead Owner)
  const accessFilter = await buildAttributionFilter(
    req.user,
    organization,
    targetUserId,
  );
  matchStage = applyAttributionFilter(matchStage, accessFilter);

  const [stats, totalPayments, totalAmountAgg] = await Promise.all([
    Payment.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
    ]),
    Payment.countDocuments(matchStage),
    Payment.aggregate([
      { $match: matchStage },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        total: totalPayments,
        totalAmount: totalAmountAgg[0]?.total || 0,
        byStatus: stats,
      },
      "Payment statistics fetched successfully",
    ),
  );
});
