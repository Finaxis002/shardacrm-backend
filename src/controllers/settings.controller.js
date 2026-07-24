import Settings from "../models/Settings.model.js";
import Lead from "../models/Lead.model.js";
import Payment from "../models/Payment.model.js";
import Reminder from "../models/Reminder.model.js";
import User from "../models/User.model.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import logger from "../utils/logger.js";

const DEFAULT_PIPELINE_STAGES = [
  { name: "New", color: "#6b7280", order: 0 },
  { name: "Interested", color: "#b86e00", order: 1 },
  { name: "Details Shared", color: "#6c35de", order: 2 },
  { name: "Success", color: "#2a7d4f", order: 3 },
  { name: "Closed", color: "#1a1a18", order: 4 },
];

const DEFAULT_PERMISSIONS = {
  "View all leads": {
    admin: true,
    manager: true,
    tl: false,
    exec: false,
    viewer: false,
  },
  "View team leads only": {
    admin: false,
    manager: true,
    tl: false,
    exec: false,
    viewer: false,
  },
  "Add leads": {
    admin: true,
    manager: true,
    tl: true,
    exec: true,
    viewer: false,
  },
  "Edit any lead": {
    admin: true,
    manager: true,
    tl: false,
    exec: false,
    viewer: false,
  },
  "Delete leads": {
    admin: true,
    manager: false,
    tl: false,
    exec: false,
    viewer: false,
  },
  "Assign leads": {
    admin: true,
    manager: true,
    tl: true,
    exec: false,
    viewer: false,
  },
  "Change lead owner": {
    admin: true,
    manager: true,
    tl: false,
    exec: false,
    viewer: false,
  },
  "Record payments": {
    admin: true,
    manager: true,
    tl: false,
    exec: false,
    viewer: false,
  },
  "Import from sheets": {
    admin: true,
    manager: true,
    tl: false,
    exec: false,
    viewer: false,
  },
  "View team": {
    admin: true,
    manager: true,
    tl: true,
    exec: false,
    viewer: false,
  },
  "Manage users": {
    admin: true,
    manager: false,
    tl: false,
    exec: false,
    viewer: false,
  },
  "Admin panel": {
    admin: true,
    manager: false,
    tl: false,
    exec: false,
    viewer: false,
  },
};

const DEFAULT_LEAD_COLUMNS = [
  "name",
  "phone",
  "source",
  "value",
  "status",
  "assign",
];

const createDefaultSettings = (organization, companyName = "") => ({
  organization,
  companyName,
  distributionMethod: "round_robin",
  distributionPool: [],
  rrIndex: 0,
  pipelineStages: DEFAULT_PIPELINE_STAGES,
  permissions: DEFAULT_PERMISSIONS,
  rbacExecOnly: true,
  rbacCoEditorsCanEdit: true,
  leadColumns: DEFAULT_LEAD_COLUMNS,
  customColumns: [],
  gcalConnected: false,
  gcalUser: "",
  gmailEnabled: false,
  gateways: {},
  defaultGateway: "",
  paymentLinkExpiry: 48,
  ai: {
    gemini: { enabled: false, key: "", model: "gemini-2.5-flash" },
    groq: { enabled: false, key: "", model: "whisper-large-v3" },
    autoAnalyse: false,
    autoAnalyseCallLogs: true,
    prompt: "",
    scanNotes: true,
  },
  currency: "₹",
  timezone: "Asia/Kolkata",
});

const normalizeSettings = (settings) => {
  if (!settings) return settings;
  const obj = settings.toObject ? settings.toObject() : settings;

  const syncedPermissions = {
    ...DEFAULT_PERMISSIONS,
    ...(obj.permissions || {}),
  };

  return {
    organization: obj.organization,
    distributionMethod: obj.distributionMethod,
    distributionPool: obj.distributionPool || [],
    rrIndex: obj.rrIndex || 0,
    pipelineStages: obj.pipelineStages || DEFAULT_PIPELINE_STAGES,
    permissions: syncedPermissions,
    rbacExecOnly: obj.rbacExecOnly !== undefined ? obj.rbacExecOnly : true,
    rbacCoEditorsCanEdit:
      obj.rbacCoEditorsCanEdit !== undefined ? obj.rbacCoEditorsCanEdit : true,
    leadColumns: obj.leadColumns || DEFAULT_LEAD_COLUMNS,
    customColumns: (obj.customColumns || []).map((col) => ({
      key: col.key,
      label: col.label,
      visible: col.visible !== undefined ? col.visible : true,
      formVisible: col.formVisible !== undefined ? col.formVisible : true,
    })),
    gcalConnected: obj.gcalConnected || false,
    gcalUser: obj.gcalUser || "",
    gmailEnabled: obj.gmailEnabled || false,
    gateways: obj.gateways || {},
    defaultGateway: obj.defaultGateway || "",
    paymentLinkExpiry: obj.paymentLinkExpiry || 48,

    // ── AI (keys stripped from response) ──
    ai: {
      gemini: {
        enabled: obj.ai?.gemini?.enabled || false,
        key: obj.ai?.gemini?.key || "",
        model: obj.ai?.gemini?.model || "gemini-2.5-flash",
        hasKey: !!obj.ai?.gemini?.key,
      },
      groq: {
        enabled: obj.ai?.groq?.enabled || false,
        key: obj.ai?.groq?.key || "",
        model: obj.ai?.groq?.model || "whisper-large-v3",
        hasKey: !!obj.ai?.groq?.key,
      },
      autoAnalyse: obj.ai?.autoAnalyse || false,
      autoAnalyseCallLogs:
        obj.ai?.autoAnalyseCallLogs !== undefined
          ? obj.ai?.autoAnalyseCallLogs
          : true,
      prompt: obj.ai?.prompt !== undefined ? obj.ai?.prompt : "",
      scanNotes: obj.ai?.scanNotes !== undefined ? obj.ai?.scanNotes : true,
    },

    companyName: obj.companyName || "",
    currency: obj.currency || "₹",
    timezone: obj.timezone || "Asia/Kolkata",
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
};

export const getSettings = asyncHandler(async (req, res) => {
  const organization = req.user.organization;
  let settings = await Settings.findOne({ organization })
    .select("+ai.gemini.key +ai.groq.key")
    .populate("distributionPool", "name email role color");
  if (!settings) {
    settings = await Settings.create(createDefaultSettings(organization));
  }
  res
    .status(200)
    .json(
      new ApiResponse(200, normalizeSettings(settings), "Settings fetched"),
    );
});

export const updateSettings = asyncHandler(async (req, res) => {
  const organization = req.user.organization;
  const update = { ...req.body };

  let settings = await Settings.findOne({ organization }).select(
    "+ai.gemini.key +ai.groq.key",
  );
  if (!settings) {
    settings = await Settings.create(createDefaultSettings(organization));
  }

  // ── Flat fields ──
  const allowedFields = [
    "distributionMethod",
    "distributionPool",
    "rrIndex",
    "pipelineStages",
    "permissions",
    "rbacExecOnly",
    "rbacCoEditorsCanEdit",
    "leadColumns",
    "customColumns",
    "gcalConnected",
    "gcalUser",
    "gmailEnabled",
    "gateways",
    "defaultGateway",
    "paymentLinkExpiry",
    "companyName",
    "currency",
    "timezone",
  ];

  allowedFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(update, field)) {
      settings[field] = update[field];
    }
  });

  // ── AI deep merge ──
  if (Object.prototype.hasOwnProperty.call(update, "ai")) {
    const incoming = update.ai || {};
    settings.ai = {
      gemini: {
        enabled:
          incoming.gemini?.enabled ?? settings.ai?.gemini?.enabled ?? false,
        key:
          incoming.gemini?.key !== undefined
            ? incoming.gemini.key
            : settings.ai?.gemini?.key || "",
        model:
          incoming.gemini?.model ||
          settings.ai?.gemini?.model ||
          "gemini-2.5-flash",
      },
      groq: {
        enabled: incoming.groq?.enabled ?? settings.ai?.groq?.enabled ?? false,
        key:
          incoming.groq?.key !== undefined
            ? incoming.groq.key
            : settings.ai?.groq?.key || "",
        model:
          incoming.groq?.model ||
          settings.ai?.groq?.model ||
          "whisper-large-v3",
      },
      autoAnalyse: incoming.autoAnalyse ?? settings.ai?.autoAnalyse ?? false,
      autoAnalyseCallLogs:
        incoming.autoAnalyseCallLogs ??
        settings.ai?.autoAnalyseCallLogs ??
        true,
      prompt:
        incoming.prompt !== undefined
          ? incoming.prompt
          : settings.ai?.prompt || "",
      scanNotes:
        incoming.scanNotes !== undefined
          ? incoming.scanNotes
          : (settings.ai?.scanNotes ?? true),
    };
  }

  await settings.save();

  settings = await Settings.findById(settings._id)
    .select("+ai.gemini.key +ai.groq.key")
    .populate("distributionPool", "name email role color");

  logger.info(`Settings updated for organization ${organization}`);
  res
    .status(200)
    .json(
      new ApiResponse(200, normalizeSettings(settings), "Settings updated"),
    );
});

export const getPipelineStages = asyncHandler(async (req, res) => {
  const organization = req.user.organization;
  let settings = await Settings.findOne({ organization });
  if (!settings)
    settings = await Settings.create(createDefaultSettings(organization));
  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        settings.pipelineStages || DEFAULT_PIPELINE_STAGES,
        "Pipeline stages fetched",
      ),
    );
});

export const updatePipelineStages = asyncHandler(async (req, res) => {
  const organization = req.user.organization;
  const { pipelineStages } = req.body;
  if (!Array.isArray(pipelineStages))
    throw new ApiError(400, "pipelineStages must be an array");

  let settings = await Settings.findOne({ organization });
  if (!settings)
    settings = await Settings.create(createDefaultSettings(organization));

  settings.pipelineStages = pipelineStages;
  await settings.save();

  settings = await Settings.findById(settings._id).populate(
    "distributionPool",
    "name email role color",
  );
  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        normalizeSettings(settings),
        "Pipeline stages updated",
      ),
    );
});

export const exportOrganizationData = asyncHandler(async (req, res) => {
  const organization = req.user.organization;
  const [users, leads, payments, reminders, settings] = await Promise.all([
    User.find({ organization }).select("-password -refreshToken").lean(),
    Lead.find({ organization }).lean(),
    Payment.find({ organization }).lean(),
    Reminder.find({ organization }).lean(),
    Settings.findOne({ organization }).lean(),
  ]);
  if (!settings) throw new ApiError(404, "Settings not found for organization");
  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { users, leads, payments, reminders, settings },
        "Export data fetched successfully",
      ),
    );
});

export const exportOnlyLeads = asyncHandler(async (req, res) => {
  const organization = req.user.organization;
  const leads = await Lead.find({ organization }).lean();
  res
    .status(200)
    .json(new ApiResponse(200, { leads }, "Leads export fetched successfully"));
});

export const clearLeads = asyncHandler(async (req, res) => {
  const organization = req.user.organization;
  const leadDelete = await Lead.deleteMany({ organization });
  const reminderDelete = await Reminder.deleteMany({ organization });
  const paymentDelete = await Payment.deleteMany({ organization });

  logger.info(`Cleared organization data for ${organization}`);
  res.status(200).json(
    new ApiResponse(
      200,
      {
        deletedLeads: leadDelete.deletedCount,
        deletedReminders: reminderDelete.deletedCount,
        deletedPayments: paymentDelete.deletedCount,
      },
      "Leads and related records cleared successfully",
    ),
  );
});

// ════════════════════════════════════════════════════
//  PER-USER AI KEYS (Admin only)
// ════════════════════════════════════════════════════

/**
 * GET actual AI keys for a user (admin only — for edit modal)
 * @route GET /api/v1/users/:userId/ai-keys
 */
export const getUserAiKeys = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const organization = req.user.organization;

  if (req.user.role !== "admin" && String(req.user._id) !== String(userId)) {
    throw new ApiError(403, "Only admin can view AI keys");
  }

  const [user, settings] = await Promise.all([
    User.findById(userId).select("+ai.gemini.key +ai.groq.key").lean(),
    Settings.findOne({ organization }).lean(),
  ]);

  if (!user) throw new ApiError(404, "User not found");

  // Fallback models from org settings
  const geminiFallbackModel = settings?.ai?.gemini?.model || "gemini-2.5-flash";
  const groqFallbackModel = settings?.ai?.groq?.model || "whisper-large-v3";

  res.status(200).json(
    new ApiResponse(
      200,
      {
        _id: user._id,
        name: user.name,
        ai: {
          gemini: {
            key: user.ai?.gemini?.key || "",
            model: user.ai?.gemini?.model || geminiFallbackModel,
            hasKey: !!user.ai?.gemini?.key,
          },
          groq: {
            key: user.ai?.groq?.key || "",
            model: user.ai?.groq?.model || groqFallbackModel,
            hasKey: !!user.ai?.groq?.key,
          },
        },
      },
      "User AI keys fetched",
    ),
  );
});

export const updateUserAiKeys = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { geminiKey, geminiModel, groqKey, groqModel } = req.body;
  const organization = req.user.organization;

  const user = await User.findOne({ _id: userId, organization });
  if (!user) throw new ApiError(404, "User not found");

  if (req.user.role !== "admin" && String(req.user._id) !== String(userId)) {
    throw new ApiError(403, "Only admin can manage other users' AI keys");
  }

  user.ai = {
    gemini: {
      key:
        geminiKey !== undefined ? geminiKey || "" : user.ai?.gemini?.key || "",
      model:
        geminiModel !== undefined
          ? geminiModel || ""
          : user.ai?.gemini?.model || "",
    },
    groq: {
      key: groqKey !== undefined ? groqKey || "" : user.ai?.groq?.key || "",
      model:
        groqModel !== undefined ? groqModel || "" : user.ai?.groq?.model || "",
    },
  };

  await user.save();

  logger.info(`AI keys updated for user ${userId} by ${req.user._id}`);

  const [settings] = await Promise.all([
    Settings.findOne({ organization }).lean(),
  ]);
  const geminiFallbackModel = settings?.ai?.gemini?.model || "gemini-2.5-flash";
  const groqFallbackModel = settings?.ai?.groq?.model || "whisper-large-v3";

  res.status(200).json(
    new ApiResponse(
      200,
      {
        _id: user._id,
        name: user.name,
        ai: {
          gemini: {
            hasKey: !!user.ai?.gemini?.key,
            model: user.ai?.gemini?.model || geminiFallbackModel,
          },
          groq: {
            hasKey: !!user.ai?.groq?.key,
            model: user.ai?.groq?.model || groqFallbackModel,
          },
        },
      },
      "User AI keys updated",
    ),
  );
});
