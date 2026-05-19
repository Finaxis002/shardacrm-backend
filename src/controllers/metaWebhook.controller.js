import crypto from "crypto";
import axios from "axios";
import Lead from "../models/Lead.model.js";
import User from "../models/User.model.js";
import Activity from "../models/Activity.model.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import logger from "../utils/logger.js";
import { findRuleForSheet, getNextAssignee } from "../controllers/distributionRule.controller.js";
import { createNotifications } from "../utils/notification.utils.js";

// ─── ENV vars (set these in your .env) ───────────────────────────────────────
// META_VERIFY_TOKEN   — tumhara custom token jo Meta ko doge verification ke liye
// META_APP_SECRET     — Meta app ka secret (signature verify karne ke liye)
// META_PAGE_ACCESS_TOKEN — Facebook page ka long-lived access token
// META_ORGANIZATION_ID   — tumhara default organization ID (fallback ke liye)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/meta/webhook
 * Meta webhook verification handshake
 */
export const verifyWebhook = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
    logger.info("Meta webhook verified successfully");
    return res.status(200).send(challenge);
  }

  logger.warn("Meta webhook verification failed — token mismatch");
  return res.status(403).json({ message: "Verification failed" });
};

/**
 * Verify X-Hub-Signature-256 header
 * Fake webhook requests se bachne ke liye
 */
const verifySignature = (rawBody, signature) => {
  if (!process.env.META_APP_SECRET) return true; // dev mode mein skip
  if (!signature) return false;

  const expected = "sha256=" + crypto
    .createHmac("sha256", process.env.META_APP_SECRET)
    .update(rawBody)
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
};

/**
 * Fetch actual lead data from Meta Graph API using leadgen_id
 */
const fetchMetaLeadData = async (leadgenId) => {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) throw new Error("META_PAGE_ACCESS_TOKEN not set in .env");

  const url = `https://graph.facebook.com/v19.0/${leadgenId}`;
  const { data } = await axios.get(url, {
    params: {
      fields: "field_data,created_time,ad_id,ad_name,form_id,campaign_name",
      access_token: token,
    },
  });

  return data;
};

/**
 * Parse Meta field_data array into a flat object
 * field_data: [{ name: "full_name", values: ["Rahul Sharma"] }, ...]
 */
const parseFieldData = (fieldData = []) => {
  const result = {};
  for (const field of fieldData) {
    const key = field.name?.toLowerCase().replace(/\s+/g, "_");
    result[key] = field.values?.[0] || "";
  }
  return result;
};

/**
 * Map Meta fields to Lead model fields
 * Meta form ke field names vary karte hain — common mappings handle kiye hain
 */
const mapToLeadFields = (parsed) => {
  return {
    name:
      parsed.full_name ||
      parsed.name ||
      [parsed.first_name, parsed.last_name].filter(Boolean).join(" ") ||
      "Unknown",
    phone:
      parsed.phone_number ||
      parsed.phone ||
      parsed.mobile_number ||
      parsed.contact_number ||
      "",
    email:
      parsed.email ||
      parsed.email_address ||
      "",
    city:
      parsed.city ||
      parsed.location ||
      parsed.area ||
      "",
  };
};

/**
 * POST /api/v1/meta/webhook
 * Receive lead events from Meta
 */
export const receiveWebhook = asyncHandler(async (req, res) => {
  // ── 1. Signature verify karo ──────────────────────────────────────────────
  const signature = req.headers["x-hub-signature-256"];
  const rawBody = req.rawBody || JSON.stringify(req.body);

  if (!verifySignature(rawBody, signature)) {
    logger.warn("Meta webhook: invalid signature");
    return res.status(401).json({ message: "Invalid signature" });
  }

  // ── 2. Turant 200 return karo (Meta 20s timeout mein fail karta hai) ──────
  res.status(200).json({ message: "OK" });

  // ── 3. Background mein lead process karo ─────────────────────────────────
  try {
    const { entry = [] } = req.body;

    for (const e of entry) {
      const pageId = e.id;
      for (const change of e.changes || []) {
        if (change.field !== "leadgen") continue;

        const { leadgen_id, form_id, ad_id, ad_name, page_id } = change.value;

        logger.info(`Meta lead received — leadgen_id: ${leadgen_id}`);

        await processMetaLead({
          leadgenId: leadgen_id,
          formId: form_id,
          adId: ad_id,
          adName: ad_name,
          pageId: page_id || pageId,
        });
      }
    }
  } catch (err) {
    logger.error(`Meta webhook processing error: ${err.message}`);
  }
});

/**
 * Core lead processing function
 * Graph API se data fetch karo, duplicate check karo, save karo, assign karo
 */
const processMetaLead = async ({ leadgenId, formId, adId, adName, pageId }) => {
  // ── Step 1: Graph API se lead data fetch karo ─────────────────────────────
  let metaData;
  try {
    metaData = await fetchMetaLeadData(leadgenId);
  } catch (err) {
    logger.error(`Meta Graph API fetch failed for ${leadgenId}: ${err.message}`);
    return;
  }

  const parsed = parseFieldData(metaData.field_data);
  const leadFields = mapToLeadFields(parsed);

  // ── Step 2: Phone number validate karo ───────────────────────────────────
  if (!leadFields.phone) {
    logger.warn(`Meta lead ${leadgenId} skipped — no phone number`);
    return;
  }

  const cleanPhone = leadFields.phone.replace(/\D/g, "").slice(-10);
  if (cleanPhone.length < 10) {
    logger.warn(`Meta lead ${leadgenId} skipped — invalid phone: ${leadFields.phone}`);
    return;
  }

  // ── Step 3: Organization determine karo ──────────────────────────────────
  // Pehle .env se lo, baad mein Meta page ID se organization lookup add kar sakte ho
  const organizationId = process.env.META_ORGANIZATION_ID;
  if (!organizationId) {
    logger.error("META_ORGANIZATION_ID not set in .env — cannot save lead");
    return;
  }

  // ── Step 4: Duplicate check — same phone + organization ───────────────────
  const existing = await Lead.findOne({
    phone: { $regex: cleanPhone + "$" },
    organization: organizationId,
  });

  if (existing) {
    logger.info(`Meta lead ${leadgenId} skipped — duplicate phone: ${cleanPhone}`);
    return;
  }

  // ── Step 5: Round robin se assignee dhundo ────────────────────────────────
  // Meta ke liye koi specific sheet nahi hoti, isliye
  // "meta_ads" naam ka rule dhundho ya fallback admin ko assign karo
  let assignedUserId = null;

  try {
    // Agar koi distribution rule "meta" naam se hai toh use karo
    // findRuleForSheet ek sheetSyncId leta hai — Meta ke liye hum
    // ek special sentinel value use karenge ya direct admin fallback
    const adminUser = await User.findOne({
      organization: organizationId,
      role: "admin",
    }).select("_id").lean();

    assignedUserId = adminUser?._id || null;

    // Agar META_DEFAULT_ASSIGNEE_ID set hai .env mein toh woh use karo
    if (process.env.META_DEFAULT_ASSIGNEE_ID) {
      assignedUserId = process.env.META_DEFAULT_ASSIGNEE_ID;
    }
  } catch (err) {
    logger.warn(`Meta lead assignee lookup failed: ${err.message}`);
  }

  if (!assignedUserId) {
    logger.error(`Meta lead ${leadgenId} — no assignee found, skipping`);
    return;
  }

  // ── Step 6: Lead save karo ────────────────────────────────────────────────
  try {
    const lead = await Lead.create({
      name: leadFields.name,
      phone: cleanPhone,
      email: leadFields.email || "",
      city: leadFields.city || "",
      source: "Meta Ads",
      status: "New",
      organization: organizationId,
      assignedTo: assignedUserId,
      createdBy: assignedUserId,
      metaAdId: adId || "",
      metaFormId: formId || "",
      metaAdName: adName || "",
    });

    // ── Step 7: Activity log karo ─────────────────────────────────────────
    await Activity.create({
      leadId: lead._id,
      type: "Note",
      text: `Lead imported from Meta Ads${adName ? ` (Ad: ${adName})` : ""}`,
      createdBy: assignedUserId,
      organization: organizationId,
    });

    // ── Step 8: Assignee ko notify karo ──────────────────────────────────
    await createNotifications({
      recipientIds: [assignedUserId.toString()],
      senderId: assignedUserId,
      organization: organizationId,
      leadId: lead._id,
      title: `New Meta Ads lead: ${lead.name}`,
      message: `A new lead from Meta Ads has been assigned to you — ${lead.name} (${cleanPhone})`,
      type: "lead_assigned",
      actionUrl: `/leads/${lead._id}`,
    });

    logger.info(`Meta lead saved: ${lead._id} — ${lead.name} (${cleanPhone})`);
  } catch (err) {
    logger.error(`Meta lead save failed for ${leadgenId}: ${err.message}`);
  }
};

