import { CrossSellRule, CrossSellLead, ScheduledEmail } from "../models/Crosssell.model.js";
import Lead from "../models/Lead.model.js";
import Activity from "../models/Activity.model.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import mongoose from "mongoose";
import sendEmail from "../utils/sendEmail.js";
import { SERVICE_CONFIG, DEFAULT_SERVICE_CONFIG, SERVICE_BENEFITS, DEFAULT_BENEFITS, buildCrossSellEmailTemplate } from "../utils/emailTemplates.js";

// ─── Default cross-sell rules ─────────────────────────────────────────────────
const DEFAULT_RULES = [
  {
    triggerService: "MSME",
    recommendations: [
      { service: "GST Registration", pitch: "After MSME registration, GST Registration is essential — you will be able to claim input tax credit and conduct smoother B2B dealings.", priority: 3 },
      { service: "Project Report", pitch: "A Project Report will be required for your bank loan — we prepare professional reports that significantly increase approval rates.", priority: 2 },
      { service: "Subsidy Services", pitch: "Government subsidies are available for MSME-registered businesses — we help you claim what you are entitled to.", priority: 1 },
    ],
  },
  {
    triggerService: "GST Registration",
    recommendations: [
      { service: "GST Return", pitch: "After GST Registration, monthly/quarterly returns must be filed — we handle all the filing for you.", priority: 3 },
      { service: "Income Tax Return", pitch: "Filing GST and ITR together saves on compliance costs — a package deal is available.", priority: 2 },
      { service: "Trade Mark", pitch: "Protect your brand — with Trade Mark registration, competitors cannot legally copy your identity.", priority: 1 },
    ],
  },
  {
    triggerService: "GST Return",
    recommendations: [
      { service: "Income Tax Return", pitch: "File ITR along with GST Return — the same financial data is used, minimizing extra cost.", priority: 3 },
      { service: "Income Tax Audit", pitch: "Crossed the turnover threshold? Audit may become mandatory — be prepared well in advance.", priority: 2 },
    ],
  },
  {
    triggerService: "Income Tax Return",
    recommendations: [
      { service: "GST Registration", pitch: "Getting a GST number is beneficial for growing your business — you will be able to claim input credit.", priority: 3 },
      { service: "Income Tax Audit", pitch: "If your income is high, audit is compulsory — we handle the entire process for you.", priority: 2 },
    ],
  },
  {
    triggerService: "Income Tax Audit",
    recommendations: [
      { service: "GST Return", pitch: "Along with the audit, keeping GST returns up to date is essential — we manage both for you.", priority: 2 },
      { service: "Project Report", pitch: "Need a loan or funding after the audit? Let us prepare a professional Project Report.", priority: 1 },
    ],
  },
  {
    triggerService: "Project Report",
    recommendations: [
      { service: "MSME", pitch: "An MSME certificate is important for your Project Report — it makes bank loan approvals easier.", priority: 3 },
      { service: "Subsidy Services", pitch: "Government subsidies may be available for your project — we check your eligibility.", priority: 2 },
    ],
  },
  {
    triggerService: "Subsidy Services",
    recommendations: [
      { service: "MSME", pitch: "MSME registration is mandatory for subsidy eligibility — apply now to get started.", priority: 3 },
      { service: "Project Report", pitch: "A detailed Project Report will be required for your subsidy application.", priority: 2 },
    ],
  },
  {
    triggerService: "Trade Mark",
    recommendations: [
      { service: "GST Registration", pitch: "A GST number adds legitimacy to your registered brand — it builds client trust.", priority: 2 },
      { service: "IEC Code", pitch: "Want to export your brand? An IEC Code is mandatory for that.", priority: 1 },
    ],
  },
  {
    triggerService: "IEC Code",
    recommendations: [
      { service: "GST Registration", pitch: "A GST number is compulsory for exports — you will be able to claim IGST refunds.", priority: 3 },
      { service: "Trade Mark", pitch: "Protecting your brand in international markets is essential — register your Trade Mark.", priority: 2 },
    ],
  },
];

// ─── Seed default rules for an org if none exist ─────────────────────────────
const seedDefaultRules = async (organization, createdBy) => {
  const existing = await CrossSellRule.countDocuments({ organization });
  if (existing > 0) return;

  const docs = DEFAULT_RULES.map((r) => ({
    organization,
    createdBy,
    triggerService: r.triggerService,
    recommendations: r.recommendations.map((rec, idx) => ({
      ...rec,
      isActive: true,
      priority: rec.priority ?? DEFAULT_RULES.length - idx,
    })),
    isActive: true,
  }));

  await CrossSellRule.insertMany(docs);
};

// ─── GET /api/v1/cross-sell/recommendations/:leadId ──────────────────────────
export const getRecommendations = asyncHandler(async (req, res) => {
  const { leadId } = req.params;
  const { organization } = req.user;

  const lead = await Lead.findOne({ _id: leadId, organization }).lean();
  if (!lead) throw new ApiError(404, "Lead not found");

  await seedDefaultRules(organization, req.user._id);

  const productName = (lead.product || "").trim();

  let rule = await CrossSellRule.findOne({
    organization,
    isActive: true,
    triggerService: productName,
  }).lean();

  if (!rule && productName) {
    rule = await CrossSellRule.findOne({
      organization,
      isActive: true,
      triggerService: { $regex: new RegExp(productName, "i") },
    }).lean();
  }

  const existing = await CrossSellLead.findOne({ leadId, organization }).lean();

  const activeRecs = rule
    ? rule.recommendations
        .filter((r) => r.isActive)
        .sort((a, b) => (b.priority || 0) - (a.priority || 0))
    : [];

 // Agar existing record hai to uske saare recommendations lo
  const allExistingRecs = existing?.recommendations || [];
  
  // Active rules se recommendations
  const merged = activeRecs.map((rec) => {
    const existingRec = allExistingRecs.find(
      (er) => er.service === rec.service
    );
    return {
      service: rec.service,
      pitch: rec.pitch,
      status: existingRec?.status || "Pending",
      respondedAt: existingRec?.respondedAt || null,
      notes: existingRec?.notes || "",
      _id: existingRec?._id || null,
    };
  });


  allExistingRecs.forEach((existingRec) => {
    const alreadyInMerged = merged.find(m => m.service === existingRec.service);
    if (!alreadyInMerged) {
      merged.push({
        service: existingRec.service,
        pitch: "",
        status: existingRec.status || "Pending",
        respondedAt: existingRec.respondedAt || null,
        notes: existingRec.notes || "",
        _id: existingRec._id || null,
      });
    }
  });

  res.status(200).json(
    new ApiResponse(200, {
      leadId,
      originalService: productName,
      recommendations: merged,
      crossSellRecordId: existing?._id || null,
      automationSent: existing?.automationSent || false,
    }, "Recommendations fetched")
  );
});

export const getSuccessLeads = asyncHandler(async (req, res) => {
  const { organization } = req.user;
  const { page = 1, limit = 20, userId } = req.query;
 const allLeads = await Lead.find({ organization }).select("name status").limit(10).lean();
 
  const matchStage = {
    organization: new mongoose.Types.ObjectId(organization),
    status: "Success",
  };
 
if (userId) {
  matchStage.assignedTo = new mongoose.Types.ObjectId(userId);
} else if (
  req.user.role !== "admin" &&
  req.user.role !== "tl" &&
  req.user.role !== "manager"
) {
  matchStage.assignedTo = new mongoose.Types.ObjectId(req.user._id);
}
 
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const total = await Lead.countDocuments(matchStage);
 
  const leads = await Lead.find(matchStage)
    .sort({ updatedAt: -1 })
    .skip(skip)
    .limit(parseInt(limit))
    .populate("assignedTo", "name email")
    .lean();
 
  
  const leadIds = leads.map((l) => l._id);
  const crossSellRecords = await CrossSellLead.find({
    leadId: { $in: leadIds },
    organization,
  }).lean();
 
  const crossSellMap = {};
  crossSellRecords.forEach((r) => {
    crossSellMap[r.leadId.toString()] = r;
  });
 
  const enrichedLeads = leads.map((lead) => ({
    ...lead,
    crossSell: crossSellMap[lead._id.toString()] || null,
  }));
 
  res.status(200).json(
    new ApiResponse(200, {
      data: enrichedLeads,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    }, "Success leads fetched")
  );
});
 
// ─── POST /api/v1/cross-sell/assign-services/:leadId ─────────────────────────

export const assignServices = asyncHandler(async (req, res) => {
  const { leadId } = req.params;
  const { services, markLeadRepeat } = req.body;
  const { organization, _id: userId } = req.user;
 
  // services = [
  //   { service: "GST Registration", willProvide: true, scheduleEmail: { scheduledAt: "...", message: "..." } },
  //   { service: "MSME", willProvide: false },
  // ]
 
  if (!services || !Array.isArray(services) || services.length === 0) {
    throw new ApiError(400, "services array is required");
  }
 
  const lead = await Lead.findOne({ _id: leadId, organization });
  if (!lead) throw new ApiError(404, "Lead not found");
 
  // CrossSellLead record 
  let crossSellRecord = await CrossSellLead.findOne({ leadId, organization });
 
  const servicesToProvide = services.filter((s) => s.willProvide);
 
  if (!crossSellRecord) {
    crossSellRecord = new CrossSellLead({
      leadId,
      organization,
      assignedTo: lead.assignedTo,
      originalService: lead.product || "",
      createdBy: userId,
      recommendations: services
  .filter((s) => s.willProvide)
  .map((s) => ({
    service: s.service,
    status: "Pending",
    respondedAt: new Date(),
    respondedBy: userId,
  })),
    });
  } else {
    // Existing record update 
    services.forEach((s) => {
  if (!s.willProvide) return; 
  
  const existing = crossSellRecord.recommendations.find(
    (r) => r.service === s.service
  );
  if (existing) {
    // existing.status = "Interested";
    existing.respondedAt = new Date();
    existing.respondedBy = userId;
  } else {
    crossSellRecord.recommendations.push({
      service: s.service,
      status: "Pending",
      respondedAt: new Date(),
      respondedBy: userId,
    });
  }
});
  }
 
  await crossSellRecord.save();
 
  // Schedule emails for selected services
  const scheduledEmails = [];
  for (const s of servicesToProvide) {
    if (s.scheduleEmail?.scheduledAt) {
      const schedDate = new Date(s.scheduleEmail.scheduledAt);
      if (isNaN(schedDate) || schedDate <= new Date()) continue;
 
      const config = SERVICE_CONFIG[s.service] || DEFAULT_SERVICE_CONFIG;
      const benefits = SERVICE_BENEFITS[s.service] || DEFAULT_BENEFITS;
 
      // Get pitch from rules
      let pitch = `${s.service} is a great addition to your business journey.`;
      const rule = await CrossSellRule.findOne({
        organization,
        "recommendations.service": s.service,
      }).lean();
      if (rule?.recommendations) {
        const rec = rule.recommendations.find((r) => r.service === s.service);
        if (rec?.pitch) pitch = rec.pitch;
      }
 
      const html = buildCrossSellEmailTemplate({
        leadName: lead.name,
        originalService: lead.product || "our service",
        recommendedService: s.service,
        pitch,
        customMessage: s.scheduleEmail.message || "",
        includeOtherServices: false,
        otherServices: [],
      });
 
      const subject = `Special offer for ${lead.name.split(" ")[0] || "you"} — ${s.service} 🎯`;
 
      const mail = await ScheduledEmail.create({
        leadId,
        organization,
        to: lead.email,
        subject,
        html,
        scheduledAt: schedDate,
        status: "pending",
        createdBy: userId,
      });
 
      scheduledEmails.push(mail);
    }
  }
 
  // Lead status Repeat 
  if (markLeadRepeat && servicesToProvide.length > 0) {
    lead.status = "Repeat";
    await lead.save();
 
    await Activity.create({
      leadId,
      type: "Note",
      text: `🔄 Lead status changed to Repeat after cross-sell services assigned: ${servicesToProvide.map((s) => s.service).join(", ")}`,
      createdBy: userId,
      organization,
    });
  }
 
  // Activity log
  await Activity.create({
    leadId,
    type: "Note",
    text: `📋 Cross-sell services manually assigned — Providing: ${servicesToProvide.map((s) => s.service).join(", ") || "none"}`,
    createdBy: userId,
    organization,
  });
 
  res.status(200).json(
    new ApiResponse(200, {
      crossSellRecord,
      scheduledEmails,
      leadStatusUpdated: markLeadRepeat && servicesToProvide.length > 0,
    }, "Services assigned successfully")
  );
});
// ─── POST /api/v1/cross-sell/respond ─────────────────────────────────────────
export const respondToRecommendation = asyncHandler(async (req, res) => {
  const { leadId, service, status, notes } = req.body;
  const { organization, _id: userId } = req.user;

  if (!leadId || !service || !status) {
    throw new ApiError(400, "leadId, service, and status are required");
  }

  const validStatuses = ["Interested", "Not Interested", "Pending", "Converted"];
  if (!validStatuses.includes(status)) {
    throw new ApiError(400, `status must be one of: ${validStatuses.join(", ")}`);
  }

  const lead = await Lead.findOne({ _id: leadId, organization }).lean();
  if (!lead) throw new ApiError(404, "Lead not found");

  let crossSellRecord = await CrossSellLead.findOne({ leadId, organization });

  if (!crossSellRecord) {
    crossSellRecord = new CrossSellLead({
      leadId,
      organization,
      assignedTo: lead.assignedTo,
      originalService: lead.product || "",
      createdBy: userId,
      recommendations: [],
    });
  }

  const recIndex = crossSellRecord.recommendations.findIndex(
    (r) => r.service === service
  );

  const recData = {
    service,
    status,
    respondedAt: new Date(),
    respondedBy: userId,
    notes: notes || "",
  };

  if (recIndex > -1) {
    crossSellRecord.recommendations[recIndex] = {
      ...crossSellRecord.recommendations[recIndex].toObject(),
      ...recData,
    };
  } else {
    crossSellRecord.recommendations.push(recData);
  }

  await crossSellRecord.save();

  if (status === "Interested" && !crossSellRecord.autoTaskCreated) {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 2);

    await Activity.create({
      leadId,
      type: "Task",
      text: `Cross-sell follow-up: ${service} — Lead has shown interest. Please follow up.`,
      taskDueDate: dueDate,
      taskAssignedTo: lead.assignedTo,
      taskCompleted: false,
      createdBy: userId,
      organization,
    });

    crossSellRecord.autoTaskCreated = true;
    await crossSellRecord.save();
  }

  const statusEmoji = status === "Interested" ? "✅" : status === "Not Interested" ? "❌" : "🔄";
  await Activity.create({
    leadId,
    type: "Note",
    text: `${statusEmoji} Cross-sell: ${service} — ${status}${notes ? `. Note: ${notes}` : ""}`,
    createdBy: userId,
    organization,
  });

  res.status(200).json(
    new ApiResponse(200, crossSellRecord, `Marked as ${status}`)
  );
});

export const sendAutomation = asyncHandler(async (req, res) => {
  const { leadId } = req.params;
  const { channel = "whatsapp", message } = req.body;
  const { organization, _id: userId } = req.user;

  const lead = await Lead.findOne({ _id: leadId, organization }).lean();
  if (!lead) throw new ApiError(404, "Lead not found");

  if (channel === "email") {
    if (!lead.email) throw new ApiError(400, "Lead does not have an email address");

    // --------------------------------------------------------------
    // 1. Agar CrossSellLead record 
    // --------------------------------------------------------------
    let crossSellRecord = await CrossSellLead.findOne({ leadId, organization }).lean();
    let pendingRecs = [];

    if (crossSellRecord && crossSellRecord.recommendations?.length) {
      pendingRecs = crossSellRecord.recommendations.filter(
        r => r.status === "Pending" || r.status === "Interested"
      );
    }

    
    if (!pendingRecs.length) {
      // Rules fetch
      await seedDefaultRules(organization, userId);
      const productName = (lead.product || "").trim();
      let rule = await CrossSellRule.findOne({
        organization,
        isActive: true,
        triggerService: productName,
      }).lean();

      if (!rule && productName) {
        rule = await CrossSellRule.findOne({
          organization,
          isActive: true,
          triggerService: { $regex: new RegExp(productName, "i") },
        }).lean();
      }

      if (!rule || !rule.recommendations?.length) {
        throw new ApiError(400, "No cross-sell rules configured for this service.");
      }

      // Active recommendations from rule (Pending status assume)
      const activeRecs = rule.recommendations.filter(r => r.isActive).sort((a,b)=>b.priority - a.priority);
      if (!activeRecs.length) throw new ApiError(400, "No active recommendations found.");

      pendingRecs = activeRecs.map(r => ({
        service: r.service,
        pitch: r.pitch,
        status: "Pending",
      }));
    }

    if (pendingRecs.length === 0) {
      throw new ApiError(400, "No active recommendations to send.");
    }

    // Pehli recommendation as main
    const mainRec = pendingRecs[0];
    const otherServices = pendingRecs.slice(1).map(r => r.service);

    const html = buildCrossSellEmailTemplate({
      leadName: lead.name,
      originalService: lead.product || "our service",
      recommendedService: mainRec.service,
      pitch: mainRec.pitch,
      customMessage: message || "",
      includeOtherServices: otherServices.length > 0,
      otherServices: otherServices,
    });

const subject = `Special offer for ${lead.name.split(" ")[0] || "you"} — ${mainRec.service} 🎯`;

// ─── Atomic lock ──────────────────
const lockResult = await CrossSellLead.findOneAndUpdate(
  {
    leadId,
    organization,
    $or: [
      { automationSent: false },
      { automationSent: { $exists: false } },
      { automationSentAt: { $lt: new Date(Date.now() - 30000) } }
    ]
  },
  {
    $set: {
      automationSent: true,
      automationSentAt: new Date(),
      assignedTo: lead.assignedTo,
      originalService: lead.product || "",
    },
    $setOnInsert: {
      leadId,
      organization,
      createdBy: userId,
      recommendations: pendingRecs.map(r => ({
        service: r.service,
        pitch: r.pitch,
        status: "Pending",
      })),
    }
  },
  { upsert: true, new: false }
);

if (lockResult && lockResult.automationSent === true) {
  return res.status(200).json(
    new ApiResponse(200, { sent: true, channel }, "Already sent recently")
  );
}
// ─────────────────────────────────────────────────────────────────────────

    await ScheduledEmail.updateMany(
      { leadId, organization, status: "pending" },
      { $set: { status: "cancelled" } }
    );

    try {
      await sendEmail({ to: lead.email, subject, html });

    
      if (!crossSellRecord) {
        const newRecord = new CrossSellLead({
          leadId,
          organization,
          assignedTo: lead.assignedTo,
          originalService: lead.product || "",
          createdBy: userId,
          recommendations: pendingRecs.map(r => ({
            service: r.service,
            pitch: r.pitch,
            status: "Pending",
          })),
          automationSent: true,
          automationSentAt: new Date(),
        });
        await newRecord.save();
      } else {
        await CrossSellLead.findOneAndUpdate(
          { leadId, organization },
          { automationSent: true, automationSentAt: new Date() },
          { upsert: true }
        );
      }

      await Activity.create({
        leadId,
        type: "Note",
        text: `📧 Cross-sell Email sent to ${lead.email} — ${pendingRecs.map(r=>r.service).join(", ")}`,
        createdBy: userId,
        organization,
      });

      return res.status(200).json(
        new ApiResponse(200, { sent: true, channel }, "Email sent successfully!")
      );
    } catch (err) {
      throw new ApiError(500, `Failed to send email: ${err.message}`);
    }
  }

  // WhatsApp channel (not implemented)
  await CrossSellLead.findOneAndUpdate(
    { leadId, organization },
    { automationSent: true, automationSentAt: new Date() },
    { upsert: true }
  );

  await Activity.create({
    leadId,
    type: "Note",
    text: `📤 Cross-sell WhatsApp automation triggered for ${lead.name}`,
    createdBy: userId,
    organization,
  });

  res.status(200).json(
    new ApiResponse(200, { sent: true, channel, leadId }, "WhatsApp automation triggered (feature coming soon)")
  );
});

// ─── GET /api/v1/cross-sell/dashboard ────────────────────────────────────────
export const getDashboard = asyncHandler(async (req, res) => {
  const { organization } = req.user;
const { dateFrom, dateTo, userId } = req.query;

  const dateFilter = {};
  if (dateFrom) dateFilter.$gte = new Date(dateFrom);
  if (dateTo) {
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    dateFilter.$lte = end;
  }

const matchStage = {
  organization: new mongoose.Types.ObjectId(organization),
};

if (userId) {
  matchStage.assignedTo = new mongoose.Types.ObjectId(userId);
} else if (
  !["admin", "tl", "manager"].includes(req.user.role)
) {
  matchStage.assignedTo = new mongoose.Types.ObjectId(req.user._id);
}
  if (dateFrom || dateTo) matchStage.createdAt = dateFilter;

  const totalRecords = await CrossSellLead.countDocuments(matchStage);

  const statusBreakdown = await CrossSellLead.aggregate([
    { $match: matchStage },
    { $unwind: "$recommendations" },
    { $group: { _id: "$recommendations.status", count: { $sum: 1 } } },
  ]);

  const topServices = await CrossSellLead.aggregate([
    { $match: matchStage }, 
    { $unwind: "$recommendations" },
    { $match: { "recommendations.status": { $in: ["Interested", "Converted"] } } },
    { $group: { _id: "$recommendations.service", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 9 },
  ]);

  const conversionByService = await CrossSellLead.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: "$originalService",
        total: { $sum: { $size: "$recommendations" } },
        interested: {
          $sum: {
            $size: {
              $filter: {
                input: "$recommendations",
                as: "r",
                cond: { $in: ["$$r.status", ["Interested", "Converted"]] },
              },
            },
          },
        },
      },
    },
    { $match: { _id: { $ne: "" } } },
    { $sort: { interested: -1 } },
  ]);

  const recent = await CrossSellLead.find(matchStage)
    .sort({ updatedAt: -1 })
    .limit(10)
    .populate("leadId", "name phone product")
    .populate("assignedTo", "name")
    .lean();

  const automationStats = await CrossSellLead.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalSent: { $sum: { $cond: ["$automationSent", 1, 0] } },
        totalPending: { $sum: { $cond: ["$automationSent", 0, 1] } },
      },
    },
  ]);

  const totalRecs = await CrossSellLead.aggregate([
    { $match: matchStage },
    { $unwind: "$recommendations" },
    { $count: "total" },
  ]);

  const interestedRecs = await CrossSellLead.aggregate([
    { $match: matchStage },
    { $unwind: "$recommendations" },
    { $match: { "recommendations.status": { $in: ["Interested", "Converted"] } } },
    { $count: "total" },
  ]);

  const totalRecsCount = totalRecs[0]?.total || 0;
  const interestedCount = interestedRecs[0]?.total || 0;
  const conversionRate =
    totalRecsCount > 0
      ? ((interestedCount / totalRecsCount) * 100).toFixed(1)
      : "0.0";

  res.status(200).json(
    new ApiResponse(200, {
      totalLeadsWithCrossSell: totalRecords,
      totalRecommendations: totalRecsCount,
      interestedCount,
      conversionRate: parseFloat(conversionRate),
      statusBreakdown,
      topServices,
      conversionByService,
      recentActivity: recent,
      automationStats: automationStats[0] || { totalSent: 0, totalPending: 0 },
    }, "Dashboard data fetched")
  );
});

// ─── GET /api/v1/cross-sell/rules ────────────────────────────────────────────
export const getRules = asyncHandler(async (req, res) => {
  const { organization } = req.user;
  await seedDefaultRules(organization, req.user._id);
  const rules = await CrossSellRule.find({ organization }).sort({ triggerService: 1 }).lean();
  res.status(200).json(new ApiResponse(200, rules, "Rules fetched"));
});

export const updateRule = asyncHandler(async (req, res) => {
  const { ruleId } = req.params;
  const { recommendations, isActive, triggerService } = req.body;
  const { organization } = req.user;

  const rule = await CrossSellRule.findOne({ _id: ruleId, organization });
  if (!rule) throw new ApiError(404, "Rule not found");

  if (recommendations !== undefined) {
    rule.recommendations = recommendations.map((r, idx) => ({
      service: r.service,
      pitch: r.pitch || "",
      priority: r.priority ?? recommendations.length - idx,
      isActive: r.isActive !== false,
    }));
  }
  if (isActive !== undefined) rule.isActive = isActive;
  if (triggerService !== undefined) {
  rule.triggerService = triggerService.trim();
}

  await rule.save();
  res.status(200).json(new ApiResponse(200, rule, "Rule updated"));
});

export const createRule = asyncHandler(async (req, res) => {
  const { triggerService, recommendations } = req.body;
  const { organization, _id: userId } = req.user;

if (!triggerService) {
    throw new ApiError(400, "triggerService is required");
  }

  let rule = await CrossSellRule.findOne({ organization, triggerService });

  if (rule) {
    rule.recommendations = recommendations;
    rule.isActive = true;
    await rule.save();
  } else {
    rule = await CrossSellRule.create({
      organization,
      triggerService: triggerService.trim(),
      recommendations: recommendations.map((r, idx) => ({
        service: r.service,
        pitch: r.pitch || "",
        priority: r.priority ?? recommendations.length - idx,
        isActive: true,
      })),
      isActive: true,
      createdBy: userId,
    });
  }

  res.status(201).json(new ApiResponse(201, rule, "Rule created/updated"));
});

// ─── POST /api/v1/cross-sell/schedule-email/:leadId ────────────────────────
export const scheduleEmail = asyncHandler(async (req, res) => {
  const { leadId } = req.params;
  const { to, subject, scheduledAt, message, recommendationService, includeOtherServices } = req.body;
  const { organization, _id: userId } = req.user;

  const lead = leadId ? await Lead.findOne({ _id: leadId, organization }).lean() : null;
  if (leadId && !lead) throw new ApiError(404, "Lead not found");

  const toFinal = to || lead?.email || null;
  if (!toFinal || !scheduledAt) throw new ApiError(400, "to and scheduledAt are required");

  const schedDate = new Date(scheduledAt);
  if (isNaN(schedDate)) throw new ApiError(400, "scheduledAt must be a valid date");

  let htmlFinal = "";
  let subjectFinal = subject || `Special offer for ${lead?.name || "you"}`;

  if (recommendationService) {
    const rule = await CrossSellRule.findOne(
      { organization, "recommendations.service": recommendationService },
      { "recommendations.$": 1 }
    ).lean();

    const pitch = rule?.recommendations?.[0]?.pitch || "This service can be highly beneficial for your business.";

    let otherServices = [];
    if (includeOtherServices) {
      const crossSellRecord = await CrossSellLead.findOne({ leadId, organization }).lean();
      otherServices = (crossSellRecord?.recommendations || [])
        .filter((r) => r.service !== recommendationService && (r.status === "Pending" || r.status === "Interested"))
        .map((r) => r.service)
        .slice(0, 3);
    }

    htmlFinal = buildCrossSellEmailTemplate({
      leadName: lead?.name || "Valued Customer",
      originalService: lead?.product || "our service",
      recommendedService: recommendationService,
      pitch,
      customMessage: message || "",
      includeOtherServices: !!includeOtherServices,
      otherServices,
    });

    subjectFinal = subject || `Special offer for ${lead?.name?.split(" ")[0] || "you"} — ${recommendationService} 🎯`;
  } else if (message) {
    htmlFinal = `<div style="font-family:Arial,sans-serif;color:#333;line-height:1.6;padding:20px;">${message}</div>`;
  }

  const mail = await ScheduledEmail.create({
    leadId: leadId || null,
    organization,
    to: toFinal,
    subject: subjectFinal,
    html: htmlFinal,
    scheduledAt: schedDate,
    status: "pending",
    createdBy: userId,
  });

 if (leadId && recommendationService) {
    let crossSellRecord = await CrossSellLead.findOne({ leadId, organization });
    if (!crossSellRecord) {
      crossSellRecord = new CrossSellLead({
        leadId,
        organization,
        assignedTo: lead?.assignedTo,
        originalService: lead?.product || "",
        createdBy: userId,
        recommendations: [],
      });
    }
    const exists = crossSellRecord.recommendations.find(
      (r) => r.service === recommendationService
    );
    if (!exists) {
      crossSellRecord.recommendations.push({
        service: recommendationService,
        status: "Pending",
        respondedAt: new Date(),
        respondedBy: userId,
      });
      await crossSellRecord.save();
    }
  }

  res.status(201).json(new ApiResponse(201, mail, "Email scheduled"));
});

// ─── GET /api/v1/cross-sell/scheduled-emails/:leadId ──────────────────────
export const getScheduledEmails = asyncHandler(async (req, res) => {
  const { leadId } = req.params;
  const { organization } = req.user;

  const query = { organization };
  if (leadId) query.leadId = leadId;

  const mails = await ScheduledEmail.find(query).sort({ scheduledAt: -1 }).lean();
  res.status(200).json(new ApiResponse(200, mails, "Scheduled emails fetched"));
});

// ─── DELETE /api/v1/cross-sell/scheduled-emails/:emailId ──────────────────
export const cancelScheduledEmail = asyncHandler(async (req, res) => {
  const { emailId } = req.params;
  const { organization } = req.user;

  const mail = await ScheduledEmail.findOne({ _id: emailId, organization });
  if (!mail) throw new ApiError(404, "Scheduled email not found");

  if (mail.status === "sent") throw new ApiError(400, "Cannot cancel a sent email");

  mail.status = "cancelled";
  await mail.save();

  res.status(200).json(new ApiResponse(200, mail, "Scheduled email cancelled"));
});
// GET /api/v1/cross-sell/leads-overview
export const getLeadsOverview = asyncHandler(async (req, res) => {
  const { organization } = req.user;
  const { userId, page = 1, limit = 20 } = req.query;

const matchStage = {
  organization: new mongoose.Types.ObjectId(organization),
};

if (userId) {
  matchStage.assignedTo = new mongoose.Types.ObjectId(userId);
} else if (
  !["admin", "tl", "manager"].includes(req.user.role)
) {
  matchStage.assignedTo = new mongoose.Types.ObjectId(req.user._id);
}

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const total = await CrossSellLead.countDocuments(matchStage);

  const records = await CrossSellLead.find(matchStage)
    .sort({ updatedAt: -1 })
    .skip(skip)
    .limit(parseInt(limit))
    .populate("leadId", "name phone product email")
    .populate("assignedTo", "name")
    .lean();

  res.status(200).json(new ApiResponse(200, {
    data: records,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / parseInt(limit)),
    }
  }, "Leads overview fetched"));
});
export const deleteRule = asyncHandler(async (req, res) => {
  const { ruleId } = req.params;
  const { organization } = req.user;

  const rule = await CrossSellRule.findOneAndDelete({
    _id: ruleId,
    organization,
  });

  if (!rule) {
    throw new ApiError(404, "Rule not found");
  }

  res
    .status(200)
    .json(new ApiResponse(200, {}, "Rule deleted"));
});