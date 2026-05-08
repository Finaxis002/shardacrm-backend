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
  aiProvider: "",
  aiKey: "",
  aiModel: "",
  aiEndpoint: "",
  aiPrompt: "",
  aiAutoAnalyse: false,
  aiScanNotes: true,
  aiIntent: false,
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
    customColumns: obj.customColumns || [],
    gcalConnected: obj.gcalConnected || false,
    gcalUser: obj.gcalUser || "",
    gmailEnabled: obj.gmailEnabled || false,
    gateways: obj.gateways || {},
    defaultGateway: obj.defaultGateway || "",
    paymentLinkExpiry: obj.paymentLinkExpiry || 48,
    aiProvider: obj.aiProvider || "",
    aiKey: obj.aiKey || "",
    aiModel: obj.aiModel || "",
    aiEndpoint: obj.aiEndpoint || "",
    aiPrompt: obj.aiPrompt || "",
    aiAutoAnalyse: obj.aiAutoAnalyse || false,
    aiScanNotes: obj.aiScanNotes !== undefined ? obj.aiScanNotes : true,
    aiIntent: obj.aiIntent || false,
    companyName: obj.companyName || "",
    currency: obj.currency || "₹",
    timezone: obj.timezone || "Asia/Kolkata",
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
};

export const getSettings = asyncHandler(async (req, res) => {
  const organization = req.user.organization;
  let settings = await Settings.findOne({ organization }).populate(
    "distributionPool",
    "name email role color",
  );

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

  let settings = await Settings.findOne({ organization });
  if (!settings) {
    settings = await Settings.create(createDefaultSettings(organization));
  }

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
    "aiProvider",
    "aiKey",
    "aiModel",
    "aiEndpoint",
    "aiPrompt",
    "aiAutoAnalyse",
    "aiScanNotes",
    "aiIntent",
    "companyName",
    "currency",
    "timezone",
  ];

  allowedFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(update, field)) {
      settings[field] = update[field];
    }
  });

  await settings.save();

  settings = await Settings.findById(settings._id).populate(
    "distributionPool",
    "name email role color",
  );

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
  if (!settings) {
    settings = await Settings.create(createDefaultSettings(organization));
  }

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        settings.pipelineStages || DEFAULT_PIPELINE_STAGES,
        "Pipeline stages fetched successfully",
      ),
    );
});

export const updatePipelineStages = asyncHandler(async (req, res) => {
  const organization = req.user.organization;
  const { pipelineStages } = req.body;

  if (!Array.isArray(pipelineStages)) {
    throw new ApiError(400, "pipelineStages must be an array");
  }

  let settings = await Settings.findOne({ organization });
  if (!settings) {
    settings = await Settings.create(createDefaultSettings(organization));
  }

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
        "Pipeline stages updated successfully",
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

  if (!settings) {
    throw new ApiError(404, "Settings not found for organization");
  }

  res.status(200).json(
    new ApiResponse(
      200,
      {
        users,
        leads,
        payments,
        reminders,
        settings,
      },
      "Export data fetched successfully",
    ),
  );
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
