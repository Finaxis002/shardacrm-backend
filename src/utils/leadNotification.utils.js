// utils/leadNotification.utils.js
// ─────────────────────────────────────────────────────────────────────────────
// Smart notification logic:
// - Sirf actual change pe notification
// - Proper title aur message har type ke liye
// - assignedTo + coAssignees + createdBy ko notification milegi
// - Sender ko bhi milegi (excludeSender: false)
// ─────────────────────────────────────────────────────────────────────────────

import {
  createNotifications,
  createNotificationsWithSender,
} from "./notification.utils.js";
import logger from "./logger.js";

// ─────────────────────────────────────────────
//  HELPER: ID extract karo
// ─────────────────────────────────────────────
const extractId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if (value._id) return String(value._id);
    if (value.id) return String(value.id);
    const str = value.toString?.();
    if (str && !str.startsWith("[object")) return str;
    return "";
  }
  return String(value);
};

// ─────────────────────────────────────────────
//  HELPER: Text truncate
// ─────────────────────────────────────────────
const truncate = (text, len = 80) => {
  if (!text) return "";
  return text.length > len ? text.substring(0, len) + "..." : text;
};

// ─────────────────────────────────────────────
//  HELPER: Field value format karo
// ─────────────────────────────────────────────
const formatFieldValue = (field, value) => {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "dealValue") return `₹${value}`;
  if (field === "closeDate") {
    return new Date(value).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  return String(value);
};

// ─────────────────────────────────────────────
//  PROFILE FIELDS → Human readable labels
// ─────────────────────────────────────────────
const PROFILE_FIELD_LABELS = {
  name: "Name",
  phone: "Phone",
  alternatePhone: "Alternate Phone",
  email: "Email",
  city: "City",
  source: "Source",
  dealValue: "Deal Value",
  product: "Product",
  closeDate: "Close Date",
  priority: "Priority",
  initialNote: "Note",
};
// Note: status alag handle hota hai sendStatusChangeNotification mein

// ═════════════════════════════════════════════════════════════════════════════
//  EXPORTED HELPERS
// ═════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────
//  Lead recipients:
//  assignedTo + coAssignees + createdBy
// ─────────────────────────────────────────────
export const buildLeadRecipients = (lead, extraIds = []) => {
  const ids = [
    extractId(lead.assignedTo),
    ...(Array.isArray(lead.coAssignees)
      ? lead.coAssignees.map((id) => extractId(id))
      : []),
    ...extraIds.map((id) => extractId(id)),
  ];
  return [...new Set(ids.filter(Boolean))];
};

// ─────────────────────────────────────────────
//  Reminder recipients:
//  assignedTo + notifyUsers
// ─────────────────────────────────────────────
export const buildReminderRecipients = (reminder) => {
  const ids = [
    extractId(reminder.assignedTo),
    ...(Array.isArray(reminder.notifyUsers)
      ? reminder.notifyUsers.map((id) => extractId(id))
      : []),
  ];
  return [...new Set(ids.filter(Boolean))];
};

// ─────────────────────────────────────────────
//  Reminder date/time format
// ─────────────────────────────────────────────
export const formatReminderDateTime = (reminder) => {
  const date = new Date(reminder.reminderDate);
  const dateStr = date.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return `${dateStr}${reminder.reminderTime ? ` at ${reminder.reminderTime}` : ""}`;
};

// ─────────────────────────────────────────────
//  Activity change detector
//  true  → change hua → notification bhejo
//  false → same hai  → skip karo
// ─────────────────────────────────────────────
export const detectActivityChange = (existing, incoming, type) => {
  // Text change?
  const existingText = (existing.text || "").trim();
  const incomingText = (incoming.text || "").trim();
  if (existingText !== incomingText) return true;

  // NotifiedUsers change?
  const normalizeIds = (val) =>
    Array.isArray(val)
      ? val
          .map((id) => extractId(id))
          .filter(Boolean)
          .sort()
      : [];
  const existingN = normalizeIds(existing.notifiedUsers);
  const incomingN = normalizeIds(incoming.notifiedUsers);
  if (JSON.stringify(existingN) !== JSON.stringify(incomingN)) return true;

  // Call specific
  if (type === "Call") {
    if ((incoming.callDuration || "") !== (existing.callDuration || ""))
      return true;
    if ((incoming.callDirection || "") !== (existing.callDirection || ""))
      return true;
    if ((incoming.callOutcome || "") !== (existing.callOutcome || ""))
      return true;
  }

  // Task specific
  if (type === "Task") {
    const existingDue = existing.taskDueDate
      ? new Date(existing.taskDueDate).toISOString().split("T")[0]
      : "";
    const incomingDue = incoming.taskDueDate
      ? new Date(incoming.taskDueDate).toISOString().split("T")[0]
      : "";
    if (existingDue !== incomingDue) return true;
    if (
      String(incoming.taskAssignedTo || "") !==
      String(existing.taskAssignedTo || "")
    )
      return true;
  }

  return false; // Koi change nahi
};

// ═════════════════════════════════════════════════════════════════════════════
//  1. PROFILE UPDATE NOTIFICATION
//  Sirf changed fields ka message banega
//  Status is excluded - status alag handle hota hai
// ═════════════════════════════════════════════════════════════════════════════
export const sendProfileUpdateNotification = async ({
  lead,
  oldLead,
  userId,
  userName,
  organization,
}) => {
  try {
    const changedFields = [];

    // ── Standard profile fields check ──
    for (const [field, label] of Object.entries(PROFILE_FIELD_LABELS)) {
      const oldVal = oldLead[field];
      const newVal = lead[field];

      const oldStr = String(oldVal ?? "").trim();
      const newStr = String(newVal ?? "").trim();

      // Same hai → skip
      if (oldStr === newStr) continue;

      changedFields.push(
        `${label}: "${formatFieldValue(field, oldVal)}" → "${formatFieldValue(field, newVal)}"`,
      );
    }

    // ── Custom fields check ──
    const oldCustom =
      oldLead.customFields instanceof Map
        ? Object.fromEntries(oldLead.customFields)
        : oldLead.customFields || {};

    const newCustom =
      lead.customFields instanceof Map
        ? Object.fromEntries(lead.customFields)
        : lead.customFields || {};

    const allCustomKeys = new Set([
      ...Object.keys(oldCustom),
      ...Object.keys(newCustom),
    ]);

    for (const key of allCustomKeys) {
      const oldVal = String(oldCustom[key] ?? "").trim();
      const newVal = String(newCustom[key] ?? "").trim();
      if (oldVal !== newVal) {
        changedFields.push(`${key}: "${oldVal || "—"}" → "${newVal || "—"}"`);
      }
    }

    // ── Koi change nahi → notification skip ──
    if (!changedFields.length) {
      logger.info(
        `Profile: No changes for lead ${lead._id}, skipping notification`,
      );
      return;
    }

    const recipients = buildLeadRecipients(lead);
    if (!recipients.length) return;

    // ── Message build ──
    // 1 field change → single line
    // Multiple fields → bullet list
    const message =
      changedFields.length === 1
        ? `${userName} updated ${changedFields[0]} for lead ${lead.name}.`
        : `${userName} updated the following for lead ${lead.name}:\n${changedFields
            .map((f) => `• ${f}`)
            .join("\n")}`;

    await createNotificationsWithSender({
      recipientIds: recipients,
      senderId: userId,
      organization,
      leadId: lead._id,
      title: `Lead Updated: ${lead.name}`,
      message,
      type: "lead_updated",
      actionUrl: `/leads/${lead._id}`,
    });

    logger.info(
      `✅ Profile notification sent | lead: ${lead._id} | ${changedFields.length} field(s) changed`,
    );
  } catch (err) {
    logger.error(`sendProfileUpdateNotification error: ${err.message}`);
  }
};

// ═════════════════════════════════════════════════════════════════════════════
//  2. STATUS CHANGE NOTIFICATION
// ═════════════════════════════════════════════════════════════════════════════
export const sendStatusChangeNotification = async ({
  lead,
  oldStatus,
  newStatus,
  userId,
  userName,
  organization,
}) => {
  try {
    // Same status → skip
    if (oldStatus === newStatus) {
      logger.info(`Status same (${oldStatus}), skipping notification`);
      return;
    }

    const recipients = buildLeadRecipients(lead);
    if (!recipients.length) return;

    await createNotificationsWithSender({
      recipientIds: recipients,
      senderId: userId,
      organization,
      leadId: lead._id,
      title: `Status Changed: ${lead.name}`,
      message: `${userName} changed status of lead ${lead.name} from "${oldStatus}" to "${newStatus}".`,
      type: "lead_status_changed",
      actionUrl: `/leads/${lead._id}`,
    });

    logger.info(
      `✅ Status notification | lead: ${lead._id} | ${oldStatus} → ${newStatus}`,
    );
  } catch (err) {
    logger.error(`sendStatusChangeNotification error: ${err.message}`);
  }
};

// ═════════════════════════════════════════════════════════════════════════════
//  3. REASSIGNMENT NOTIFICATION
// ═════════════════════════════════════════════════════════════════════════════
export const sendReassignmentNotification = async ({
  lead,
  oldAssigneeId,
  newAssigneeName,
  oldAssigneeName,
  userId,
  userName,
  organization,
}) => {
  try {
    // Old assignee ko bhi include karo
    const recipients = buildLeadRecipients(lead, [oldAssigneeId]);
    if (!recipients.length) return;

    await createNotificationsWithSender({
      recipientIds: recipients,
      senderId: userId,
      organization,
      leadId: lead._id,
      title: `Lead Reassigned: ${lead.name}`,
      message: `${userName} reassigned lead ${lead.name} from ${
        oldAssigneeName || "Unassigned"
      } to ${newAssigneeName || "Unknown"}.`,
      type: "lead_reassigned",
      actionUrl: `/leads/${lead._id}`,
    });

    logger.info(`✅ Reassignment notification | lead: ${lead._id}`);
  } catch (err) {
    logger.error(`sendReassignmentNotification error: ${err.message}`);
  }
};

// ═════════════════════════════════════════════════════════════════════════════
//  4. ACTIVITY NOTIFICATION
//  Note, Call, Email, Meeting, Task
// ═════════════════════════════════════════════════════════════════════════════
export const sendActivityNotification = async ({
  lead,
  activity,
  userId,
  userName,
  organization,
  isUpdate = false,
}) => {
  try {
    const { type } = activity;
    const ACTION = isUpdate ? "Updated" : "Added";

    // ── Title map ──
    const titleMap = {
      Note: `Note ${ACTION}`,
      Call: `Call ${ACTION}`,
      Email: `Email ${ACTION}`,
      Meeting: `Meeting ${ACTION}`,
      Task: `Task ${ACTION}`,
    };

    // ── Message map ──
    const messageMap = {
      Note: () =>
        `${userName} ${isUpdate ? "updated" : "added"} a note for lead ${
          lead.name
        }${activity.text ? `: "${truncate(activity.text)}"` : "."}`,

      Call: () => {
        let msg = `${userName} ${isUpdate ? "updated" : "logged"} a ${
          activity.callDirection || "Outgoing"
        } call for lead ${lead.name}.`;
        if (activity.callDuration)
          msg += ` Duration: ${activity.callDuration}.`;
        if (activity.callOutcome) msg += ` Outcome: ${activity.callOutcome}.`;
        if (activity.text) msg += ` Note: "${truncate(activity.text)}"`;
        return msg;
      },

      Email: () =>
        `${userName} ${isUpdate ? "updated" : "sent"} an email for lead ${
          lead.name
        }${activity.text ? `: "${truncate(activity.text)}"` : "."}`,

      Meeting: () =>
        `${userName} ${isUpdate ? "updated" : "scheduled"} a meeting for lead ${
          lead.name
        }${activity.text ? `: "${truncate(activity.text)}"` : "."}`,

      Task: () => {
        let msg = `${userName} ${isUpdate ? "updated" : "created"} a task for lead ${lead.name}`;
        if (activity.text) msg += `: "${truncate(activity.text)}"`;
        if (activity.taskDueDate) {
          msg += `. Due: ${new Date(activity.taskDueDate).toLocaleDateString(
            "en-IN",
            {
              day: "numeric",
              month: "short",
              year: "numeric",
            },
          )}`;
        }
        return msg + ".";
      },
    };

    const title = titleMap[type];
    const messageFn = messageMap[type];

    // Unknown type → skip
    if (!title || !messageFn) {
      logger.warn(`sendActivityNotification: Unknown type "${type}", skipping`);
      return;
    }

    // ── Recipients: lead people + notifiedUsers ──
    const notifiedIds = Array.isArray(activity.notifiedUsers)
      ? activity.notifiedUsers.map((id) => extractId(id))
      : [];

    const recipients = [...buildLeadRecipients(lead), ...notifiedIds];
    const uniqueRecipients = [...new Set(recipients.filter(Boolean))];

    if (!uniqueRecipients.length) return;

    await createNotificationsWithSender({
      recipientIds: uniqueRecipients,
      senderId: userId,
      organization,
      leadId: lead._id,
      title,
      message: messageFn(),
      type: `activity_${type.toLowerCase()}`,
      actionUrl: `/leads/${lead._id}`,
    });

    logger.info(
      `✅ Activity notification | type: ${type} | ${ACTION} | lead: ${lead._id}`,
    );
  } catch (err) {
    logger.error(`sendActivityNotification error: ${err.message}`);
  }
};

// ═════════════════════════════════════════════════════════════════════════════
//  5. PAYMENT NOTIFICATION
//  Sirf tab aayegi jab payment actually create/change ho
// ═════════════════════════════════════════════════════════════════════════════
export const sendPaymentNotification = async ({
  lead,
  payment,
  userId,
  userName,
  organization,
  isUpdate = false,
}) => {
  try {
    const ACTION = isUpdate ? "Updated" : "Received";
    const title = `Payment ${ACTION}: ${lead.name}`;

    let message = `${userName} ${
      isUpdate ? "updated" : "recorded"
    } a payment of ₹${payment.amount} for lead ${lead.name}.`;

    if (payment.paymentMode) message += ` Mode: ${payment.paymentMode}.`;
    if (payment.status) message += ` Status: ${payment.status}.`;
    if (payment.reference) message += ` Ref: ${payment.reference}.`;

    const recipients = buildLeadRecipients(lead);
    if (!recipients.length) return;

    await createNotificationsWithSender({
      recipientIds: recipients,
      senderId: userId,
      organization,
      leadId: lead._id,
      title,
      message,
      type: isUpdate ? "payment_updated" : "payment_created",
      actionUrl: `/leads/${lead._id}`,
    });

    logger.info(
      `✅ Payment notification | ${ACTION} ₹${payment.amount} | lead: ${lead._id}`,
    );
  } catch (err) {
    logger.error(`sendPaymentNotification error: ${err.message}`);
  }
};

// ═════════════════════════════════════════════════════════════════════════════
//  6. RECORDING NOTIFICATION
//  added | updated | deleted
// ═════════════════════════════════════════════════════════════════════════════
export const sendRecordingNotification = async ({
  lead,
  recording,
  previousRecording,
  userId,
  userName,
  organization,
  action = "added",
}) => {
  try {
    const titleMap = {
      added: `Recording Added: ${lead.name}`,
      updated: `Recording Updated: ${lead.name}`,
      deleted: `Recording Deleted: ${lead.name}`,
    };

    const messageMap = {
      added: `${userName} added a recording${
        recording?.label ? ` "${recording.label}"` : ""
      } for lead ${lead.name}.`,

      updated: `${userName} updated the recording${
        recording?.label ? ` "${recording.label}"` : ""
      } for lead ${lead.name}.`,

      deleted: `${userName} deleted the recording${
        previousRecording?.label ? ` "${previousRecording.label}"` : ""
      } for lead ${lead.name}.`,
    };

    const recipients = buildLeadRecipients(lead);
    if (!recipients.length) return;

    const typeMap = {
      added: "recording_added",
      updated: "recording_updated",
      deleted: "recording_deleted",
    };

    await createNotificationsWithSender({
      recipientIds: recipients,
      senderId: userId,
      organization,
      leadId: lead._id,
      title: titleMap[action],
      message: messageMap[action],
      type: typeMap[action],
      actionUrl: `/leads/${lead._id}`,
    });

    logger.info(`✅ Recording notification | ${action} | lead: ${lead._id}`);
  } catch (err) {
    logger.error(`sendRecordingNotification error: ${err.message}`);
  }
};

// ═════════════════════════════════════════════════════════════════════════════
//  7. REMINDER NOTIFICATION
//  created | updated | deleted
// ═════════════════════════════════════════════════════════════════════════════
export const sendReminderNotification = async ({
  lead,
  reminder,
  userId,
  userName,
  organization,
  action = "created",
}) => {
  try {
    const titleMap = {
      created: `Reminder Created: ${reminder.type || "Follow-up"}`,
      updated: `Reminder Updated: ${reminder.type || "Follow-up"}`,
      deleted: `Reminder Deleted: ${reminder.type || "Follow-up"}`,
    };

    const dateTime = formatReminderDateTime(reminder);

    const messageMap = {
      created: `${userName} created a ${
        reminder.type || "Follow-up"
      } reminder for lead ${lead.name} on ${dateTime}.${
        reminder.note ? ` Note: "${reminder.note}"` : ""
      }`,
      updated: `${userName} updated the ${
        reminder.type || "Follow-up"
      } reminder for lead ${lead.name} to ${dateTime}.${
        reminder.note ? ` Note: "${reminder.note}"` : ""
      }`,
      deleted: `${userName} deleted the ${
        reminder.type || "Follow-up"
      } reminder for lead ${lead.name}.`,
    };

    // Reminder recipients: assignedTo + notifyUsers
    const recipients = buildReminderRecipients(reminder);
    if (!recipients.length) return;

    await createNotificationsWithSender({
      recipientIds: recipients,
      senderId: userId,
      organization,
      leadId: lead._id,
      title: titleMap[action],
      message: messageMap[action],
      type: `reminder_${action}`,
      actionUrl: `/leads/${lead._id}`,
    });

    logger.info(`✅ Reminder notification | ${action} | lead: ${lead._id}`);
  } catch (err) {
    logger.error(`sendReminderNotification error: ${err.message}`);
  }
};
