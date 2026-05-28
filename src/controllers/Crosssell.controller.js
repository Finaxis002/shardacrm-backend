import { CrossSellRule, CrossSellLead, ScheduledEmail } from "../models/CrossSell.model.js";
import Lead from "../models/Lead.model.js";
import Activity from "../models/Activity.model.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import mongoose from "mongoose";
import sendEmail from "../utils/sendEmail.js";
// ─── SERVICE CONFIG ───────────────────────────────────────────────────────────
const SERVICE_CONFIG = {
  "MSME":               { color: "#1d4ed8", lightBg: "#eff6ff", accent: "#3b82f6", icon: "🏭", tagline: "Get official government recognition for your business", badge: "Business Registration" },
  "GST Registration":   { color: "#15803d", lightBg: "#f0fdf4", accent: "#22c55e", icon: "📋", tagline: "Register for GST and claim input tax credit", badge: "Tax Compliance" },
  "GST Return":         { color: "#b45309", lightBg: "#fefce8", accent: "#f59e0b", icon: "📊", tagline: "File timely returns and avoid penalties", badge: "Monthly Filing" },
  "Income Tax Return":  { color: "#7e22ce", lightBg: "#fdf4ff", accent: "#a855f7", icon: "💼", tagline: "Declare your income correctly and save on taxes", badge: "Annual Filing" },
  "Income Tax Audit":   { color: "#be123c", lightBg: "#fff1f2", accent: "#f43f5e", icon: "🔍", tagline: "Ensure compliance and stay protected from notices", badge: "Audit Services" },
  "Project Report":     { color: "#c2410c", lightBg: "#fff7ed", accent: "#f97316", icon: "📄", tagline: "Increase your bank loan approval chances", badge: "Loan Support" },
  "Subsidy Services":   { color: "#0f766e", lightBg: "#f0fdfa", accent: "#14b8a6", icon: "💰", tagline: "Get the full benefit of government schemes", badge: "Govt Benefits" },
  "Trade Mark":         { color: "#a21caf", lightBg: "#fdf2f8", accent: "#d946ef", icon: "™️", tagline: "Protect your brand identity legally", badge: "IP Protection" },
  "IEC Code":           { color: "#0369a1", lightBg: "#f0f9ff", accent: "#0ea5e9", icon: "🌐", tagline: "Expand your business into international markets", badge: "Export License" },
};
const DEFAULT_SERVICE_CONFIG = { color: "#4f46e5", lightBg: "#eef2ff", accent: "#6366f1", icon: "📦", tagline: "Take your business to the next level", badge: "Our Services" };

const generateServiceBanner = (service, config) => {
  const { color, accent, icon } = config;
  return `<svg width="600" height="200" viewBox="0 0 600 200" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:auto;"><defs><linearGradient id="bg${service.replace(/\s/g, '')}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:${color};stop-opacity:1" /><stop offset="100%" style="stop-color:${accent};stop-opacity:1" /></linearGradient></defs><rect width="600" height="200" rx="12" fill="url(#bg${service.replace(/\s/g, '')})" /><circle cx="520" cy="30" r="80" fill="white" fill-opacity="0.06" /><circle cx="560" cy="120" r="100" fill="white" fill-opacity="0.05" /><circle cx="80" cy="170" r="60" fill="white" fill-opacity="0.07" /><circle cx="30" cy="40" r="40" fill="white" fill-opacity="0.05" /><circle cx="420" cy="60" r="2" fill="white" fill-opacity="0.2" /><circle cx="450" cy="60" r="2" fill="white" fill-opacity="0.2" /><circle cx="480" cy="60" r="2" fill="white" fill-opacity="0.2" /><circle cx="420" cy="90" r="2" fill="white" fill-opacity="0.2" /><circle cx="450" cy="90" r="2" fill="white" fill-opacity="0.2" /><circle cx="480" cy="90" r="2" fill="white" fill-opacity="0.2" /><circle cx="420" cy="120" r="2" fill="white" fill-opacity="0.2" /><circle cx="450" cy="120" r="2" fill="white" fill-opacity="0.2" /><circle cx="480" cy="120" r="2" fill="white" fill-opacity="0.2" /><rect x="40" y="50" width="80" height="80" rx="20" fill="white" fill-opacity="0.15" /><text x="80" y="105" text-anchor="middle" font-size="40" font-family="Apple Color Emoji, Segoe UI Emoji, sans-serif">${icon}</text><rect x="150" y="55" width="130" height="26" rx="13" fill="white" fill-opacity="0.2" /><text x="215" y="72" text-anchor="middle" font-size="11" font-weight="600" fill="white" font-family="Arial, sans-serif" letter-spacing="0.5">${config.badge.toUpperCase()}</text><text x="150" y="115" font-size="26" font-weight="700" fill="white" font-family="Arial, sans-serif">${service}</text><text x="150" y="142" font-size="13" fill="white" fill-opacity="0.85" font-family="Arial, sans-serif">${config.tagline}</text><text x="560" y="188" text-anchor="end" font-size="11" fill="white" fill-opacity="0.5" font-family="Arial, sans-serif">ShardaCRM</text></svg>`;
};

const SERVICE_BENEFITS = {
  "MSME": [
    "Become eligible for government loans and subsidies",
    "Faster bank credit processing with MSME certificate",
    "Avail tax rebates and priority sector lending benefits",
    "Participate in international trade exhibitions and tenders",
  ],
  "GST Registration": [
    "Claim Input Tax Credit on purchased goods and services",
    "Conduct B2B dealings and work with large companies",
    "GST registration is mandatory for selling on e-commerce platforms",
    "Enhance brand credibility with a registered GSTIN number",
  ],
  "GST Return": [
    "Avoid penalties and late fees with timely filing",
    "Current returns are required to claim ITC refunds",
    "GST return history is required for bank loans",
    "Maintain a clean compliance record for future audits",
  ],
  "Income Tax Return": [
    "ITR serves as proof of income for visa applications",
    "ITR is mandatory for bank loans and credit card approvals",
    "Filing ITR is required to claim TDS refunds",
    "Carry forward business losses to future financial years",
  ],
  "Income Tax Audit": [
    "Audit is compulsory to avoid scrutiny notices",
    "Accurate financial statements are prepared through audit",
    "Errors and discrepancies are caught early in the audit process",
    "Investor confidence increases with audited financial accounts",
  ],
  "Project Report": [
    "Bank loan approval chances increase by up to 3x",
    "Mandatory document for subsidy applications",
    "Business plan is clearly defined for investors and lenders",
    "Prove eligibility for government schemes with a detailed report",
  ],
  "Subsidy Services": [
    "Get up to 50% subsidy on machinery purchases",
    "Reduce loan interest through interest subvention schemes",
    "Lower your working capital requirements significantly",
    "Receive free government funding for business expansion",
  ],
  "Trade Mark": [
    "No one can legally copy or misuse your brand",
    "Registered trademark significantly increases brand value",
    "Brand protection on all major e-commerce platforms",
    "Serves as the foundation for international trademark registration",
  ],
  "IEC Code": [
    "Legally start your import-export business operations",
    "Claim IGST refund on exports with an IEC code",
    "Deal directly with foreign buyers and international clients",
    "Claim government export incentives and schemes",
  ],
};
const DEFAULT_BENEFITS = [
  "Professionally manage your business operations",
  "Ensure full legal compliance at all times",
  "Build a strong foundation for future growth",
  "Get expert guidance from an experienced team",
];

const buildCrossSellEmailTemplate = ({ leadName, originalService, recommendedService, pitch, customMessage, includeOtherServices, otherServices = [] }) => {
  const config = SERVICE_CONFIG[recommendedService] || DEFAULT_SERVICE_CONFIG;
  const origConfig = SERVICE_CONFIG[originalService] || DEFAULT_SERVICE_CONFIG;
  const benefits = SERVICE_BENEFITS[recommendedService] || DEFAULT_BENEFITS;
  const bannerSvg = generateServiceBanner(recommendedService, config);

  const otherServicesHtml = includeOtherServices && otherServices.length > 0
    ? `<tr><td style="padding:0 40px 32px;"><p style="margin:0 0 14px;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">You may also be interested in</p><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">${otherServices.map((s, i) => {
        const sc = SERVICE_CONFIG[s] || DEFAULT_SERVICE_CONFIG;
        return `<tr style="border-bottom:${i < otherServices.length - 1 ? "1px solid #f1f5f9" : "none"};"><td style="padding:14px 16px;"><table cellpadding="0" cellspacing="0"><tr><td style="padding-right:12px;font-size:20px;vertical-align:middle;">${sc.icon}</td><td><p style="margin:0;font-size:14px;font-weight:600;color:#1e293b;">${s}</p><p style="margin:2px 0 0;font-size:12px;color:#64748b;">${sc.tagline}</p></td><td style="text-align:right;vertical-align:middle;padding-left:12px;"><span style="display:inline-block;background:${sc.lightBg};color:${sc.color};font-size:11px;font-weight:600;padding:4px 10px;border-radius:20px;">${sc.badge}</span></td></tr></table></td></tr>`;
      }).join("")}</table></td></tr>`
    : "";

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${recommendedService} — Special Offer for You</title></head><body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;"><tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

<tr><td style="background:${config.color};padding:12px 40px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td><p style="margin:0;font-size:13px;font-weight:700;color:white;letter-spacing:0.05em;">ShardaCRM</p></td><td align="right"><p style="margin:0;font-size:12px;color:rgba(255,255,255,0.7);">Specially curated for you</p></td></tr></table></td></tr>

<tr><td style="padding:0;line-height:0;">${bannerSvg}</td></tr>

<tr><td style="padding:36px 40px 24px;">
  <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;line-height:1.3;">Hello ${leadName}! 👋</p>
  <p style="margin:0;font-size:15px;color:#475569;line-height:1.6;">You had contacted us for <strong style="color:${origConfig.color};">${originalService}</strong>. To further strengthen your business journey, we have identified one more important service that could benefit you greatly.</p>
</td></tr>

<tr><td style="padding:0 40px;"><div style="height:1px;background:linear-gradient(to right,transparent,#e2e8f0,transparent);"></div></td></tr>

<tr><td style="padding:28px 40px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${config.lightBg};border-radius:16px;border:1.5px solid ${config.color}30;overflow:hidden;">
    <tr><td style="padding:24px;">
      <table cellpadding="0" cellspacing="0" style="margin-bottom:16px;"><tr><td style="background:${config.color};border-radius:20px;padding:5px 14px;"><p style="margin:0;font-size:11px;font-weight:700;color:white;letter-spacing:0.08em;text-transform:uppercase;">⭐ Recommended for You</p></td></tr></table>
      <p style="margin:0 0 12px;font-size:22px;font-weight:700;color:${config.color};">${config.icon} ${recommendedService}</p>
      <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:white;border-radius:10px;padding:16px;border-left:3px solid ${config.color};">
        <p style="margin:0;font-size:14px;color:#334155;line-height:1.65;">💬 ${pitch}</p>
      </td></tr></table>
      ${customMessage ? `<p style="margin:16px 0 0;font-size:14px;color:#475569;line-height:1.6;">${customMessage}</p>` : ""}
    </td></tr>
  </table>
</td></tr>

<tr><td style="padding:0 40px 32px;">
  <p style="margin:0 0 14px;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Why should you choose this service?</p>
  <table width="100%" cellpadding="0" cellspacing="0">
    ${benefits.map((b, i) => `<tr><td style="padding:8px 0;${i < benefits.length - 1 ? "border-bottom:1px solid #f1f5f9;" : ""}"><table cellpadding="0" cellspacing="0"><tr><td style="vertical-align:top;padding-right:10px;"><div style="width:22px;height:22px;border-radius:50%;background:${config.lightBg};display:inline-flex;align-items:center;justify-content:center;"><span style="font-size:12px;color:${config.color};font-weight:700;">✓</span></div></td><td><p style="margin:0;font-size:14px;color:#334155;line-height:1.5;">${b}</p></td></tr></table></td></tr>`).join("")}
  </table>
</td></tr>

${otherServicesHtml}

<tr><td style="padding:0 40px 36px;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center"><table cellpadding="0" cellspacing="0"><tr><td style="background:${config.color};border-radius:12px;padding:14px 36px;"><p style="margin:0;font-size:16px;font-weight:700;color:white;">📞 Call Us Now — Free Consultation</p></td></tr></table></td></tr>
    <tr><td align="center" style="padding-top:12px;"><p style="margin:0;font-size:13px;color:#94a3b8;">Reply to this email or call us at: <strong style="color:#475569;">+91-XXXXXXXXXX</strong></p></td></tr>
  </table>
</td></tr>

<tr><td style="padding:0 40px;"><div style="height:1px;background:#f1f5f9;"></div></td></tr>

<tr><td style="padding:24px 40px;background:#f8fafc;border-radius:0 0 20px 20px;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr>
    <td><p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#334155;">ShardaCRM Team</p><p style="margin:0;font-size:12px;color:#94a3b8;">This email has been personally prepared for you.</p></td>
    <td align="right" style="vertical-align:top;"><p style="margin:0;font-size:22px;">${config.icon}</p></td>
  </tr></table>
</td></tr>

</table><p style="margin:16px 0 0;font-size:12px;color:#94a3b8;text-align:center;">© ${new Date().getFullYear()} ShardaCRM · Your business growth is our responsibility</p></td></tr></table></body></html>`;
};

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

  const merged = activeRecs.map((rec) => {
    const existingRec = existing?.recommendations?.find(
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
    // 1. Agar CrossSellLead record nahi hai, to rules se recommendations lo
    // --------------------------------------------------------------
    let crossSellRecord = await CrossSellLead.findOne({ leadId, organization }).lean();
    let pendingRecs = [];

    if (crossSellRecord && crossSellRecord.recommendations?.length) {
      pendingRecs = crossSellRecord.recommendations.filter(
        r => r.status === "Pending" || r.status === "Interested"
      );
    }

    // Agar record nahi hai ya usme koi pending/interested nahi hai, to rules se generate karo
    if (!pendingRecs.length) {
      // Rules fetch karo
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

    try {
      await sendEmail({ to: lead.email, subject, html });

      // --------------------------------------------------------------
      // 2. Agar pehle se CrossSellLead nahi tha, to ab bana do (taaki future responses kaam karein)
      // --------------------------------------------------------------
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

  const matchStage = { organization: new mongoose.Types.ObjectId(organization) };
  if (userId) {
  matchStage.assignedTo = new mongoose.Types.ObjectId(userId);
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

  await rule.save();
  res.status(200).json(new ApiResponse(200, rule, "Rule updated"));
});

export const createRule = asyncHandler(async (req, res) => {
  const { triggerService, recommendations } = req.body;
  const { organization, _id: userId } = req.user;

  if (!triggerService || !recommendations?.length) {
    throw new ApiError(400, "triggerService and recommendations required");
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
