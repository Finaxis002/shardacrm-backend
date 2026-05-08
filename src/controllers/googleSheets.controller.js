import GoogleSheetSync from "../models/GoogleSheetSync.model.js";
import Lead from "../models/Lead.model.js";
import Activity from "../models/Activity.model.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import logger from "../utils/logger.js";
import { google } from "googleapis";
import DistributionRule from "../models/DistributionRule.model.js";
import {
  findRuleForSheet,
  getNextAssignee,
} from "./distributionRule.controller.js";
/* ═══════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════ */

const VALID_CRM_FIELDS = [
  "name",
  "phone",
  "email",
  "city",
  "source",
  "status",
  "dealValue",
  "product",
  "priority",
  "closeDate",
  "skip",
];

const VALID_SOURCES = [
  "Google Ads",
  "Website",
  "Referral",
  "Walk-in",
  "Cold Call",
  "Social Media",
  "Google Sheet",
  "Other",
];

const VALID_PRIORITIES = ["Normal", "High", "Urgent"];

const normalizePriority = (val) => {
  if (!val) return "Normal";
  const match = VALID_PRIORITIES.find(
    (p) => p.toLowerCase() === String(val).trim().toLowerCase(),
  );
  return match || "Normal";
};

const parseDate = (val) => {
  if (!val && val !== 0) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === "number") {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + val * 86400000);
    return isNaN(date.getTime()) ? null : date;
  }
  const str = String(val).trim();
  if (!str || ["n/a", "na", ""].includes(str.toLowerCase())) return null;
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Fetch rows from Google Sheets API
 * Returns array of arrays (rows)
 */
const getServiceAccountAuth = () => {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const serviceAccountPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;

  const authOptions = {
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  };

  if (serviceAccountJson) {
    try {
      authOptions.credentials = JSON.parse(serviceAccountJson);
    } catch (err) {
      throw new ApiError(500, "Invalid GOOGLE_SERVICE_ACCOUNT_JSON provided");
    }
  } else if (serviceAccountPath) {
    authOptions.keyFile = serviceAccountPath;
  } else {
    authOptions.keyFile = "shardacrm-bcd1191276f4.json";
  }

  return new google.auth.GoogleAuth(authOptions);
};

const fetchSheetRows = async (
  sheetId,
  tabName,
  accessToken,
  fromRow = 1,
  toRow = 1000,
) => {
  try {
    const auth = getServiceAccountAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const range = `'${tabName}'!A${fromRow}:Z${toRow}`;

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range,
    });

    return response.data.values || [];
  } catch (err) {
    throw new ApiError(400, `Google Sheets API error: ${err.message}`);
  }
};

/**
 * Convert a row array + fieldMappings + fixedValues → lead object
 */
const rowToLead = (row, fieldMappings, fixedValues = []) => {
  const lead = {};

  // Apply column mappings
  fieldMappings.forEach(({ sheetColumnIndex, crmField }) => {
    if (crmField === "skip") return;
    if (crmField === "status") return;
    if (lead[crmField] !== undefined) return;
    lead[crmField] = row[sheetColumnIndex] ?? "";
  });

  // Apply fixed values (override)
  fixedValues.forEach(({ crmField, value }) => {
    if (crmField === "status") return;
    lead[crmField] = value;
  });

  return lead;
};

const saveLeadsFromRows = async ({ rows, fieldMappings, fixedValues, organization, createdBy, assignedTo, syncId, sheetName }) => {
  console.log("Total rows to process:", rows.length);
  console.log("Sample row:", rows[0]);
    console.log("💥 saveLeadsFromRows sheetName received:", sheetName);

  // Distribution rule dhundho
  let distributionRule = null;
  let activeRuleInfo = null;
  if (syncId) {
    distributionRule = await findRuleForSheet(syncId, organization);
    if (distributionRule) {
      activeRuleInfo = {
        ruleId: String(distributionRule._id),
        ruleType: distributionRule.rule,
        sheetSyncIds:
          distributionRule.sheetSyncIds?.map((id) => String(id)) || [],
        userPool: distributionRule.userPool?.map((id) => String(id)) || [],
      };
      console.log("Distribution rule matched:", activeRuleInfo);
    } else {
      console.log("No active distribution rule found for syncId:", syncId);
    }
  }

  let imported = 0;
  let skipped = 0;
  const processedPhones = new Set();
  for (const row of rows) {
    const leadData = rowToLead(row, fieldMappings, fixedValues);

    // Phone clean - sirf last 10 digits lo
    if (leadData.phone) {
      leadData.phone = String(leadData.phone)
        .replace(/\D/g, "") // p:, +, spaces sab hatao
        .slice(-10); // right se sirf 10 digits
    }

    if (!leadData.name?.trim() || !leadData.phone?.trim()) {
      console.log(
        "Skipped - missing name/phone:",
        leadData.name,
        leadData.phone,
      );
      skipped++;
      continue;
    }

    const phoneClean = String(leadData.phone).trim();

    // Assignee decide karo - distribution rule se ya default
    let finalAssignee = assignedTo || createdBy;
    let assignmentSource = "default";
    let assignedRule = null;

    if (distributionRule && distributionRule.rule !== "manual") {
      const nextUser = await getNextAssignee(distributionRule);
      if (nextUser) {
        finalAssignee = nextUser;
        assignmentSource = "rule";
        assignedRule = distributionRule.rule;
      }
    }

    console.log(`Sheet sync ${syncId} → lead=${leadData.name || "<no-name>"} phone=${phoneClean} assignedTo=${String(finalAssignee)} source=${assignmentSource}` +
      (assignedRule ? ` rule=${assignedRule}` : "") +
      (activeRuleInfo ? ` ruleId=${activeRuleInfo.ruleId}` : ""));

if (processedPhones.has(phoneClean)) {
  skipped++;
  continue;
}
processedPhones.add(phoneClean);

const existing = await Lead.findOne({ phone: phoneClean, organization });
console.log("Phone check:", phoneClean, "| Existing found:", !!existing);
const emailRaw = String(leadData.email || "").trim().toLowerCase();
const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
const validEmail = emailRaw && emailRegex.test(emailRaw) ? emailRaw : undefined;

const sourceRaw = String(leadData.source || "").trim();

if (existing) {
  // Naya lead banao Repeat status ke saath
  const repeatLead = new Lead({
    name:        String(leadData.name).trim(),
    phone:       phoneClean,
    email:       validEmail,
    city:        leadData.city || "",
    source:      VALID_SOURCES.includes(sourceRaw) ? sourceRaw : "Google Sheet",
    status:      "Repeat",
    dealValue:   Number(leadData.dealValue) || 0,
    product:     leadData.product || "",
    priority:    normalizePriority(leadData.priority),
    closeDate:   parseDate(leadData.closeDate),
    assignedTo:  finalAssignee,
    organization,
    createdBy,
    isDuplicate: true,
     sheetName:   sheetName || "",
  });

  await repeatLead.save();

    

  imported++;
  continue;
}

const lead = new Lead({
  name:       String(leadData.name).trim(),
  phone:      phoneClean,
  email:      validEmail,
  city:       leadData.city || "",
  source:     VALID_SOURCES.includes(sourceRaw) ? sourceRaw : "Google Sheet",
 status:     "New",
  dealValue:  Number(leadData.dealValue) || 0,
  product:    leadData.product || "",
  priority:   normalizePriority(leadData.priority),
  closeDate:  parseDate(leadData.closeDate),
  assignedTo: finalAssignee,
  organization,
  createdBy,
  isDuplicate: false,
  sheetName:  sheetName || "",   
});

    await lead.save();

    await Activity.create({
      leadId: lead._id,
      type: "Note",
      text: "Lead imported via Google Sheet auto-sync",
      createdBy,
      organization,
    });

    imported++;
  }

  return { imported, skipped };
};

/* ═══════════════════════════════════════════
   CONTROLLERS
═══════════════════════════════════════════ */

/**
 * GET /api/v1/google-sheets/connections
 * List all sheet connections for this org
 */
export const getConnections = asyncHandler(async (req, res) => {
  const organization = req.user.organization;

  const connections = await GoogleSheetSync.find({ organization })
    .sort({ createdAt: -1 })
    .lean();

  res
    .status(200)
    .json(new ApiResponse(200, connections, "Connections fetched"));
});

/**
 * POST /api/v1/google-sheets/register
 * Step 1: Register sheet + save access token + get headers with sample data
 * Body: { googleEmail, sheetId, sheetName, tabName, sheetUrl, accessToken }
 */
export const registerSheet = asyncHandler(async (req, res) => {
  console.log("Frontend se aaya data:", req.body);
  const { googleEmail, sheetId, sheetName, tabName, sheetUrl, accessToken } =
    req.body;
  const organization = req.user.organization;
  const createdBy = req.user._id;

  // googleEmail ko check se hata dein, baaki rehne dein
  if (!sheetId || !sheetName || !tabName || !accessToken) {
    throw new ApiError(
      400,
      "Required fields are missing: sheetId, sheetName, tabName, or accessToken",
    );
  }

  // Fetch first 3 rows to get headers + sample data
  const rows = await fetchSheetRows(sheetId, tabName, accessToken, 1, 4);
  if (!rows.length) throw new ApiError(400, "Sheet is empty or unreadable");
  console.log("Rows fetched:", rows);
  const headers = rows[0] || [];
  const sampleRow = rows[1] || [];

  // Auto-detect mapping
  const autoRules = {
    name: /name|full_name/i,
    phone: /phone|mobile|contact/i,
    email: /email|mail/i,
    city: /city|location|area/i,
    source: /source|channel|platform/i,
    status: /status|stage|response/i,
    dealValue: /value|amount|deal|price|sales/i,
    product: /product|service|business/i,
    priority: /priority|urgency/i,
    closeDate: /close|closing|date/i,
  };

  const usedFields = new Set();
  const fieldMappings = headers.map((header, idx) => {
    const col = String.fromCharCode(65 + idx); // A, B, C...
    let crmField = "skip";

    for (const [field, regex] of Object.entries(autoRules)) {
      if (regex.test(header) && !usedFields.has(field)) {
        crmField = field;
        usedFields.add(field);
        break;
      }
    }

    return {
      sheetColumn: col,
      sheetColumnIndex: idx,
      crmField,
      sampleData: String(sampleRow[idx] || ""),
    };
  });

  // Save to DB
  const sync = await GoogleSheetSync.create({
    organization,
    createdBy,
    googleEmail,
    sheetId,
    sheetName,
    tabName,
    sheetUrl: sheetUrl || "",
    fieldMappings,
    fixedValues: [],
    accessToken,
    tokenExpiresAt: new Date(Date.now() + 55 * 60 * 1000), // ~55 min
    lastRowSynced: 0, // header row = row 1, data starts at row 2
    isActive: false, // inactive until user confirms mapping
  });

  logger.info(`Google Sheet registered: ${sync._id} by ${createdBy}`);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        syncId: sync._id,
        fieldMappings,
        totalHeaders: headers.length,
      },
      "Sheet registered. Configure mapping now.",
    ),
  );
});

/**
 * PUT /api/v1/google-sheets/:syncId/mapping
 * Step 2: Save confirmed mapping + fixed values, do first import, activate sync
 * Body: { fieldMappings: [...], fixedValues: [...] }
 */
export const saveMapping = asyncHandler(async (req, res) => {
  const { syncId } = req.params;
  const { fieldMappings, fixedValues = [] } = req.body;
  const organization = req.user.organization;
  const createdBy = req.user._id;

  if (!fieldMappings?.length) throw new ApiError(400, "fieldMappings required");

  const sync = await GoogleSheetSync.findOne({ _id: syncId, organization });
  if (!sync) throw new ApiError(404, "Sheet sync not found");

  // Validate required fields
  const mapped = fieldMappings.map((f) => f.crmField);
  if (!mapped.includes("name"))
    throw new ApiError(400, "Name column must be mapped");
  if (!mapped.includes("phone"))
    throw new ApiError(400, "Phone column must be mapped");

  sync.fieldMappings = fieldMappings;
  sync.fixedValues = fixedValues;
  sync.isActive = true;
  await sync.save();

  // Respond immediately, run first import in background
  res.status(202).json(
    new ApiResponse(
      202,
      {
        syncId: sync._id,
        status: "first_import_started",
        message: "Mapping saved. First import running in background.",
      },
      "Mapping saved",
    ),
  );

  // Background: first import
  runFirstImport({ sync, organization, createdBy }).catch((err) => {
    logger.error(`First import failed for ${syncId}: ${err.message}`);
  });
});

/**
 * Background: First import — fetch all existing rows
 */
const runFirstImport = async ({ sync, organization, createdBy }) => {
  // Fresh fetch karo DB se
  const freshSync = await GoogleSheetSync.findById(sync._id).lean();
  const sheetName = freshSync?.sheetName || sync.sheetName || "";
  
  console.log("🔍 runFirstImport sheetName:", sheetName);
  
  try {
    const rows = await fetchSheetRows(sync.sheetId, sync.tabName, sync.accessToken, 2, 10000);
    console.log("First import - rows fetched:", rows.length, "syncId:", sync._id);

    const { imported, skipped } = await saveLeadsFromRows({
      rows,
      fieldMappings: sync.fieldMappings,
      fixedValues: sync.fixedValues,
      organization,
      createdBy,
      assignedTo:    createdBy,
      syncId:        sync._id,
      sheetName,          // ← fresh value
    });

    sync.lastRowSynced = rows.length + 1;
    sync.lastSyncedAt = new Date();
    sync.totalImported += imported;
    sync.lastError = null;
    await sync.save();

    logger.info(
      `First import done for ${sync._id}: ${imported} imported, ${skipped} skipped`,
    );
  } catch (err) {
    sync.lastError = err.message;
    await sync.save();
    logger.error(`First import error ${sync._id}: ${err.message}`);
  }
};

/**
 * PUT /api/v1/google-sheets/:syncId/token
 * Refresh access token when user re-authenticates
 * Body: { accessToken }
 */
export const refreshToken = asyncHandler(async (req, res) => {
  const { syncId } = req.params;
  const { accessToken } = req.body;
  const organization = req.user.organization;

  if (!accessToken) throw new ApiError(400, "accessToken required");

  const sync = await GoogleSheetSync.findOne({ _id: syncId, organization });
  if (!sync) throw new ApiError(404, "Sheet sync not found");

  sync.accessToken = accessToken;
  sync.tokenExpiresAt = new Date(Date.now() + 55 * 60 * 1000);
  sync.lastError = null;
  await sync.save();

  res.status(200).json(new ApiResponse(200, { syncId }, "Token refreshed"));
});

/**
 * DELETE /api/v1/google-sheets/:syncId
 * Disconnect / delete a sheet sync
 */
export const deleteConnection = asyncHandler(async (req, res) => {
  const { syncId } = req.params;
  const organization = req.user.organization;

  const sync = await GoogleSheetSync.findOneAndDelete({
    _id: syncId,
    organization,
  });
  if (!sync) throw new ApiError(404, "Sheet sync not found");

  logger.info(`Google Sheet sync deleted: ${syncId}`);
  res.status(200).json(new ApiResponse(200, { syncId }, "Connection removed"));
});

/**
 * GET /api/v1/google-sheets/:syncId/status
 * Get sync status for polling from frontend
 */
export const getSyncStatus = asyncHandler(async (req, res) => {
  const { syncId } = req.params;
  const organization = req.user.organization;

  const sync = await GoogleSheetSync.findOne({ _id: syncId, organization })
    .select(
      "isActive lastRowSynced lastSyncedAt lastError totalImported sheetName tabName",
    )
    .lean();

  if (!sync) throw new ApiError(404, "Sheet sync not found");

  res.status(200).json(new ApiResponse(200, sync, "Status fetched"));
});

/**
 * Internal use by poller job — exported for sheetPoller.job.js
 * Syncs new rows for a single GoogleSheetSync document
 */
export const syncNewRows = async (sync) => {
    console.log("🔍 syncNewRows sheetName:", sync.sheetName);
  try {
    const fromRow = sync.lastRowSynced + 1;

      const freshSync = await GoogleSheetSync.findById(sync._id).lean();
    const sheetName = freshSync?.sheetName || sync.sheetName || "";
    
    // DEBUG - baad mein hatana hai
    logger.info(
      `Sync ${sync._id} | lastRowSynced: ${sync.lastRowSynced} | fetching from row: ${fromRow}`,
    );

    const rows = await fetchSheetRows(
      sync.sheetId,
      sync.tabName,
      sync.accessToken,
      fromRow,
      fromRow + 500,
    );

    if (!rows.length) {
      logger.info(`No new rows for sync ${sync._id}`);
      return;
    }

    const { imported, skipped } = await saveLeadsFromRows({
      rows,
      fieldMappings: sync.fieldMappings,
      fixedValues: sync.fixedValues,
      organization: sync.organization,
      createdBy: sync.createdBy,
      assignedTo: sync.createdBy,
      syncId: sync._id,
        sheetName,
    });

    sync.lastRowSynced += rows.length - skipped;
    sync.lastSyncedAt = new Date();
    sync.totalImported += imported;
    sync.lastError = null;
    await sync.save();

    if (imported > 0) {
      logger.info(
        `Auto-sync ${sync._id}: ${imported} new leads imported, ${skipped} skipped`,
      );
    }
  } catch (err) {
    sync.lastError = err.message;
    await sync.save();
    logger.error(`Auto-sync error for ${sync._id}: ${err.message}`);
  }
};
export const getSheetData = asyncHandler(async (req, res) => {
  const { syncId } = req.params;
  const organization = req.user.organization;

  const sync = await GoogleSheetSync.findOne({ _id: syncId, organization });
  if (!sync) throw new ApiError(404, "Sheet sync not found");

  const rows = await fetchSheetRows(sync.sheetId, sync.tabName, sync.accessToken, 1, 100);
  if (!rows.length) return res.status(200).json(new ApiResponse(200, [], "No data"));

  const headers = rows[0];
  const dataRows = rows.slice(1).map(row =>
    headers.reduce((obj, header, idx) => {
      obj[header] = row[idx] ?? "";
      return obj;
    }, {})
  );

  res.status(200).json(new ApiResponse(200, dataRows, "Sheet data fetched"));
});