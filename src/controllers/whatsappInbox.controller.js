import mongoose from "mongoose";
import Lead from "../models/Lead.model.js";
import WhatsappMessage from "../models/WhatsappMessage.model.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";

/**
 * NOTE ON ASSUMPTIONS (please adjust field names if your Lead schema differs):
 *  - Lead.assignedTo   -> ObjectId ref "User"  (the executive/owner the lead is assigned to)
 *  - Lead.status       -> String               (lead status shown in the CRM info drawer)
 *  - Lead.tags         -> [String]              (optional)
 *  - Lead.notes        -> String                (optional)
 *  - req.user.role     -> "admin" | "manager" | "executive" (whatever your auth middleware sets)
 *  - req.user._id      -> current logged-in user id
 *
 * If any of these differ in your actual Lead.model.js, just rename the fields below —
 * the aggregation shape returned to the frontend stays the same either way.
 */

/**
 * GET /whatsapp/conversations
 * Returns one row per lead that has at least one WhatsApp message, with:
 *  - lead basic info (name, phone, owner)
 *  - last message preview + timestamp
 *  - unread count
 * Role based:
 *  - admin/manager (or anyone with "view_team" style permission) -> sees all leads' conversations
 *  - executive -> sees only conversations for leads assigned to them
 *
 * Query params:
 *  - search: string (matches lead name or phone)
 *  - filter: "all" | "unread" | "groups" (groups is a no-op placeholder — WhatsApp Business
 *            group chats aren't modeled in this schema; kept so the frontend filter pill
 *            doesn't have to special-case its absence)
 */
export const getConversations = asyncHandler(async (req, res) => {
  const { search = "", filter = "all" } = req.query;
  const currentUser = req.user;

  const isPrivileged =
    currentUser?.role === "admin" || currentUser?.role === "manager";

  // ── Base lead match: scope to org, then scope to "my leads" unless privileged ──
  const leadMatch = {
    organization: currentUser.organization,
    phone: { $regex: /[6-9]\d{9}$/ }, // sirf valid 10-digit Indian mobile pattern wali leads
  };

  const andConditions = [];

  if (!isPrivileged) {
    const uid = new mongoose.Types.ObjectId(currentUser._id);
    andConditions.push({
      $or: [
        { assignedTo: uid },
        { coAssignees: uid }, // 👈 field ka exact naam Lead.model.js se confirm kar lena
      ],
    });
  }

  if (search?.trim()) {
    const safe = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    andConditions.push({
      $or: [
        { name: { $regex: safe, $options: "i" } },
        { phone: { $regex: safe, $options: "i" } },
      ],
    });
  }

  if (andConditions.length > 0) {
    leadMatch.$and = andConditions;
  }

  const leads = await Lead.find(leadMatch)
    .select("name phone assignedTo coAssignees status tags notes createdAt")
    .populate("assignedTo", "name email")
    .populate("coAssignees", "name email")
    .lean();

  if (leads.length === 0) {
    return res
      .status(200)
      .json(new ApiResponse(200, [], "No conversations found"));
  }

  // ── Same phone number wali multiple leads ho to WhatsApp list me sirf ek dikhao ──
  // (Leads page pe dono alag hi rahengi, ye sirf yahan display ke liye hai)
  const normalizePhone = (p) => String(p || "").replace(/\D/g, "").slice(-10);
  const seenPhones = new Map(); // normalizedPhone -> lead
  for (const lead of leads) {
    const key = normalizePhone(lead.phone);
    const existing = seenPhones.get(key);
    if (!existing) {
      seenPhones.set(key, lead);
    } else if (new Date(lead.createdAt) > new Date(existing.createdAt)) {
      // do leads ka phone same hai to jo naya (recent) hai usko rakho
      seenPhones.set(key, lead);
    }
  }
  const dedupedLeads = Array.from(seenPhones.values());

  const leadIds = dedupedLeads.map((l) => l._id);

  // ── Last message + unread count per lead, in one aggregation ──
  const stats = await WhatsappMessage.aggregate([
    { $match: { leadId: { $in: leadIds }, type: "chat" } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$leadId",
        lastMessage: { $first: "$$ROOT" },
        unreadCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$direction", "incoming"] },
                  { $eq: ["$readByAgent", false] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  const statsByLead = new Map(stats.map((s) => [String(s._id), s]));

  let conversations = dedupedLeads
    .map((lead) => {
      const stat = statsByLead.get(String(lead._id));
      const lm = stat?.lastMessage || null;
      return {
        leadId: lead._id,
        name: lead.name || "Unknown",
        phone: lead.phone,
        owner: lead.assignedTo
          ? { id: lead.assignedTo._id, name: lead.assignedTo.name }
          : null,
        coAssignees: Array.isArray(lead.coAssignees)
          ? lead.coAssignees.map((u) => ({ id: u._id, name: u.name }))
          : [],
        status: lead.status || null,
        tags: lead.tags || [],
        notes: lead.notes || "",
        unreadCount: stat?.unreadCount || 0,
        lastMessage: lm
          ? {
              body: lm.body || (lm.mediaUrl ? "📎 Attachment" : ""),
              direction: lm.direction,
              status: lm.status,
              isVoiceNote: lm.isVoiceNote,
              mediaUrl: lm.mediaUrl || "",
              createdAt: lm.createdAt,
            }
          : null,
      };
    });

  if (filter === "unread") {
    conversations = conversations.filter((c) => c.unreadCount > 0);
  }

  if (filter === "assigned") {
    const uid = String(currentUser._id);
    conversations = conversations.filter((c) => c.owner?.id && String(c.owner.id) === uid);
  }

  if (filter === "co-assigned") {
    const uid = String(currentUser._id);
    conversations = conversations.filter((c) =>
      c.coAssignees.some((u) => String(u.id) === uid),
    );
  }

  // "groups" -> intentionally returns empty since group chats aren't modeled yet
  if (filter === "groups") {
    conversations = [];
  }

  conversations.sort((a, b) => {
    const aTime = a.lastMessage?.createdAt ? new Date(a.lastMessage.createdAt).getTime() : 0;
    const bTime = b.lastMessage?.createdAt ? new Date(b.lastMessage.createdAt).getTime() : 0;
    return bTime - aTime;
  });

  res
    .status(200)
    .json(new ApiResponse(200, conversations, "Conversations fetched"));
});
