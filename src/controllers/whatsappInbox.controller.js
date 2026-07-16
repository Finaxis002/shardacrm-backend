import mongoose from "mongoose";
import Lead from "../models/Lead.model.js";
import WhatsappMessage from "../models/WhatsappMessage.model.js";
import WhatsappContact from "../models/WhatsappContact.model.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";

export const getConversations = asyncHandler(async (req, res) => {
  const { search = "", filter = "all", agentUserId = "" } = req.query;
  const currentUser = req.user;
  const orgId = currentUser.organization;
  const uid = String(currentUser._id);

  const isPrivileged =
    currentUser?.role === "admin" || currentUser?.role === "manager";

  const normalizePhone = (p) => String(p || "").replace(/\D/g, "").slice(-10);

  // ── User-scoping ab aggregation ke $match stage mein hi karo — warna
  //    lastMessage globally-most-recent utha leta hai chahe woh kisi doosre
  //    agent/exec ke WhatsApp session se aaya ho, jab ki thread khulne par
  //    getWhatsAppMessages sirf isi user ke messages dikhata hai (mismatch).
  const messageMatch = { organization: new mongoose.Types.ObjectId(orgId), type: "chat" };
  if (!isPrivileged) {
    const uid = new mongoose.Types.ObjectId(currentUser._id);
    messageMatch.$or = [{ waUserId: uid }, { sentBy: uid }];
  } else if (agentUserId) {
    const aid = new mongoose.Types.ObjectId(agentUserId);
    messageMatch.$or = [{ waUserId: aid }, { sentBy: aid }];
  }

  // ── Step 1: WhatsApp par jitni bhi phone numbers se baat hui hai — Lead ho ya na ho ──
  const messageGroups = await WhatsappMessage.aggregate([
    { $match: messageMatch },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$phone",
        lastMessage: { $first: "$$ROOT" },
        unreadCount: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ["$direction", "incoming"] }, { $eq: ["$readByAgent", false] }] },
              1,
              0,
            ],
          },
        },
        waUserIds: { $addToSet: "$waUserId" },
      },
    },
  ]);

  if (messageGroups.length === 0) {
    return res.status(200).json(new ApiResponse(200, [], "No conversations found"));
  }

  // Groups ka phone field pura groupJid hota hai ("...@g.us") — Lead-matching se exclude karo
  const nonGroupGroups = messageGroups.filter((g) => !String(g._id).endsWith("@g.us"));
  const phones = nonGroupGroups.map((g) => normalizePhone(g._id));

  // ── Step 2: Inn phone numbers ke liye jo Lead records maujood hain unhe optional-link karo ──
  const leads = phones.length
    ? await Lead.find({
        organization: orgId,
        phone: { $regex: `(${phones.join("|")})$` },
      })
    .select("name phone assignedTo coAssignees status tags notes createdAt")
        .populate("assignedTo", "name email")
        .populate("coAssignees", "name email")
        .lean()
    : [];

  const leadByPhone = new Map();
  for (const lead of leads) {
    const key = normalizePhone(lead.phone);
    const existing = leadByPhone.get(key);
    if (!existing || new Date(lead.createdAt) > new Date(existing.createdAt)) {
      leadByPhone.set(key, lead);
    }
  }

  // ── Step 3: WhatsApp naam/DP — Lead na ho tab bhi milega ──
  const waContacts = phones.length
    ? await WhatsappContact.find({
        organization: orgId,
        phone: { $in: phones },
      }).lean()
    : [];
  const contactByPhone = new Map(waContacts.map((c) => [c.phone, c]));

  // ── Step 4: Assemble ──
  let conversations = messageGroups.map((group) => {
    const isGroupConv = String(group._id).endsWith("@g.us");
    const lm = group.lastMessage;
    const waUserIds = (group.waUserIds || []).filter(Boolean).map(String);

    if (isGroupConv) {
      return {
        leadId: null,
        phone: group._id,
        groupJid: group._id,
        isGroup: true,
        name: lm?.groupSubject || "WhatsApp Group",
        profilePicUrl: "",
        owner: null,
        coAssignees: [],
        status: null,
        tags: [],
        notes: "",
        unreadCount: group.unreadCount || 0,
        _waUserIds: waUserIds,
        lastMessage: lm
          ? {
              body: lm.body || (lm.mediaUrl ? "📎 Attachment" : ""),
              direction: lm.direction,
              status: lm.status,
              isVoiceNote: lm.isVoiceNote,
              mediaUrl: lm.mediaUrl || "",
              createdAt: lm.createdAt,
              senderName: lm.senderName || "",
            }
          : null,
      };
    }

    const phone = normalizePhone(group._id);
    const lead = leadByPhone.get(phone) || null;
    const waContact = contactByPhone.get(phone) || null;

    return {
      leadId: lead?._id || null,
      phone: group._id,
      isGroup: false,
      name: waContact?.waName || lead?.name || group._id,
      profilePicUrl: waContact?.profilePicUrl || "",
      owner: lead?.assignedTo ? { id: lead.assignedTo._id, name: lead.assignedTo.name } : null,
      coAssignees: Array.isArray(lead?.coAssignees)
        ? lead.coAssignees.map((u) => ({ id: u._id, name: u.name }))
        : [],
      status: lead?.status || null,
      tags: lead?.tags || [],
      notes: lead?.notes || "",
      unreadCount: group.unreadCount || 0,
      _waUserIds: waUserIds,
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

   conversations = conversations.map(({ _waUserIds, ...rest }) => rest);

  if (search?.trim()) {
    const safe = search.trim().toLowerCase();
    conversations = conversations.filter(
      (c) => c.name?.toLowerCase().includes(safe) || c.phone?.includes(safe),
    );
  }

  if (filter === "unread") {
    conversations = conversations.filter((c) => c.unreadCount > 0);
  }
  if (filter === "assigned") {
    conversations = conversations.filter((c) => c.owner?.id && String(c.owner.id) === uid);
  }
  if (filter === "co-assigned") {
    conversations = conversations.filter((c) => c.coAssignees.some((u) => String(u.id) === uid));
  }
  if (filter === "groups") {
    conversations = conversations.filter((c) => c.isGroup);
  }

  conversations.sort((a, b) => {
    const aTime = a.lastMessage?.createdAt ? new Date(a.lastMessage.createdAt).getTime() : 0;
    const bTime = b.lastMessage?.createdAt ? new Date(b.lastMessage.createdAt).getTime() : 0;
    return bTime - aTime;
  });

  res.status(200).json(new ApiResponse(200, conversations, "Conversations fetched"));
});
