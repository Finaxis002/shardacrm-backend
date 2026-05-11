import DistributionRule from "../models/DistributionRule.model.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import logger from "../utils/logger.js";
import mongoose from "mongoose";
import Attendance from "../models/Attendance.model.js";

const getISTHour = () => {
  return parseInt(
    new Date().toLocaleString("en-IN", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Kolkata",
    }),
    10
  );
};
 
// ─── Helper: Today's present user IDs ────────────────────────────────────────
const getTodayPresentUserIds = async () => {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });
 
  const records = await Attendance.find({ date: today, status: "present" })
    .select("userId")
    .lean();
 
  return new Set(records.map((r) => r.userId.toString()));
};
 
// ─── Main ─────────────────────────────────────────────────────────────────────
export const getNextAssignee = async (rule) => {
  console.log(`\n--- 🎯 Distribution Logic Started ---`);
 
  if (!rule) return null;
  if (!rule.userPool || rule.userPool.length === 0) return null;
  if (rule.rule === "manual") return null;
 
  const fullPool = rule.userPool.map((u) => u.toString());
 
  // ── 10 AM ke baad attendance filter lagao ────────────────────────────────
  const istHour = getISTHour();
  let activePool = fullPool; // default: sabko use karo
 
  if (istHour >= 10) {
    const presentIds = await getTodayPresentUserIds();
    // Pool mein se sirf present users
    const presentPool = fullPool.filter((id) => presentIds.has(id));
 
    console.log(
      `🕙 IST=${istHour}h | Pool: ${fullPool.length} total, ${presentPool.length} present`
    );
 
    if (presentPool.length > 0) {
      activePool = presentPool; // sirf present wale
    } else {
      // Koi present nahi → full pool use karo (default behaviour same rahega)
      console.log("⚠️  No present users found — falling back to full pool");
      activePool = fullPool;
    }
  } else {
    console.log(`🕙 IST=${istHour}h — Before 10 AM, no attendance check`);
  }
 
  // ── Round Robin ───────────────────────────────────────────────────────────
  if (rule.rule === "round_robin") {
    const updatedRule = await DistributionRule.findByIdAndUpdate(
      rule._id,
      { $inc: { rrIndex: 1 } },
      { new: true, select: "rrIndex userPool name" }
    );
 
    const index = (updatedRule.rrIndex - 1) % activePool.length;
    const assignee = activePool[index];
 
    console.log(
      `✅ RR: rrIndex=${updatedRule.rrIndex} | activePool=${activePool.length} | Assignee=${assignee}`
    );
    return assignee;
  }
 
  // ── Equal Load ────────────────────────────────────────────────────────────
  if (rule.rule === "equal_load") {
    const freshRule = await DistributionRule.findById(rule._id).lean();
    if (!freshRule) return null;
 
    let minCount = Infinity;
    let selectedUser = activePool[0];
 
    for (const userId of activePool) {
      const count =
        (freshRule.leadCounts instanceof Map
          ? freshRule.leadCounts.get(userId)
          : freshRule.leadCounts[userId]) || 0;

      if (count < minCount) {
        minCount = count;
        selectedUser = userId;
      }
    }

    await DistributionRule.updateOne(
      { _id: rule._id },
      { $inc: { [`leadCounts.${selectedUser}`]: 1 } }
    );

    console.log(`✅ Equal Load: Selected=${selectedUser} | minCount=${minCount}`);
    return selectedUser;
  }

  return null;
};

/**
 * Find rule for a given sheetSyncId
 * Called internally from sheet sync
 */
const ensureSheetSyncIdsNotUsed = async (sheetSyncIds, organization, excludeRuleId = null) => {
  const query = {
    organization,
    isActive: true,
    sheetSyncIds: { $in: sheetSyncIds.map((id) => new mongoose.Types.ObjectId(id)) },
  };

  if (excludeRuleId) {
    query._id = { $ne: new mongoose.Types.ObjectId(excludeRuleId) };
  }

  const conflict = await DistributionRule.findOne(query).select("_id name sheetSyncIds").lean();
  if (conflict) {
    throw new ApiError(
      400,
      `Sheet already assigned to another active rule (${conflict.name}). Remove it from that rule first.`
    );
  }
};

export const findRuleForSheet = async (sheetSyncId, organization) => {
  const syncObjectId = mongoose.isValidObjectId(sheetSyncId)
    ? new mongoose.Types.ObjectId(sheetSyncId.toString())
    : null;

  const query = {
    organization,
    isActive: true,
    $or: [
      { sheetSyncIds: sheetSyncId },
    ],
  };

  if (syncObjectId) {
    query.$or.unshift({ sheetSyncIds: syncObjectId });
  }

  const rule = await DistributionRule.findOne(query);

  if (!rule) {
    logger.info(`No active distribution rule matched for sheetSyncId=${sheetSyncId}`);
  }

  return rule;
};

/**
 * GET /api/v1/distribution-rules
 */
export const getRules = asyncHandler(async (req, res) => {
  const organization = req.user.organization;

  const rules = await DistributionRule.find({ organization })
    .populate("userPool", "name email role")
    .populate("sheetSyncIds", "sheetName tabName")
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json(new ApiResponse(200, rules, "Rules fetched"));
});

/**
 * POST /api/v1/distribution-rules
 */
export const createRule = asyncHandler(async (req, res) => {
  const { name, sheetSyncIds, rule, userPool } = req.body;
  const organization = req.user.organization;
  const createdBy = req.user._id;

  if (!name?.trim()) throw new ApiError(400, "Name is required");
  if (!sheetSyncIds?.length) throw new ApiError(400, "Select at least one sheet");
  if (!userPool?.length) throw new ApiError(400, "Select at least one user");

  await ensureSheetSyncIdsNotUsed(sheetSyncIds, organization);

  const newRule = await DistributionRule.create({
    organization,
    createdBy,
    name: name.trim(),
    sheetSyncIds,
    rule: rule || "round_robin",
    userPool,
    rrIndex: 0,
    leadCounts: new Map(userPool.map((id) => [id.toString(), 0])),
  });

  await newRule.populate("userPool", "name email role");
  await newRule.populate("sheetSyncIds", "sheetName tabName");

  logger.info(`Distribution rule created: ${newRule._id} by ${createdBy}`);

  res.status(201).json(new ApiResponse(201, newRule, "Rule created"));
});

/**
 * PUT /api/v1/distribution-rules/:id
 */
export const updateRule = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, sheetSyncIds, rule, userPool, isActive } = req.body;
  const organization = req.user.organization;

  const existing = await DistributionRule.findOne({ _id: id, organization });
  if (!existing) throw new ApiError(404, "Rule not found");

  if (sheetSyncIds !== undefined) {
    await ensureSheetSyncIdsNotUsed(sheetSyncIds, organization, id);
    existing.sheetSyncIds = sheetSyncIds;
  }

  if (name !== undefined) existing.name = name.trim();
  if (rule !== undefined) existing.rule = rule;
  if (isActive !== undefined) existing.isActive = isActive;

  if (userPool !== undefined) {
    existing.userPool = userPool;
    // Reset counts for new pool
    existing.leadCounts = new Map(userPool.map((id) => [id.toString(), 0]));
    existing.rrIndex = 0;
  }

  await existing.save();
  await existing.populate("userPool", "name email role");
  await existing.populate("sheetSyncIds", "sheetName tabName");

  res.status(200).json(new ApiResponse(200, existing, "Rule updated"));
});

/**
 * DELETE /api/v1/distribution-rules/:id
 */
export const deleteRule = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const organization = req.user.organization;

  const rule = await DistributionRule.findOneAndDelete({ _id: id, organization });
  if (!rule) throw new ApiError(404, "Rule not found");

  res.status(200).json(new ApiResponse(200, { id }, "Rule deleted"));
});