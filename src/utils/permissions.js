import Settings from "../models/Settings.model.js";
import { DEFAULT_PERMISSIONS } from "../constants/permissions.js";

export const PERMISSION_LABELS = {
  view_all_leads: "View all leads",
  view_team_leads_only: "View team leads only",
  add_leads: "Add leads",
  edit_any_lead: "Edit any lead",
  delete_leads: "Delete leads",
  assign_leads: "Assign leads",
  change_lead_owner: "Change lead owner",
  record_payments: "Record payments",
  import_leads: "Import from sheets",
  view_team: "View team",
  manage_users: "Manage users",
  admin_panel: "Admin panel",
};

export const permissionSlugToLabel = (slug) => PERMISSION_LABELS[slug] || "";

export const canUser = async (user, organization, permissionSlug) => {
  if (!user) return false;
  if (user.role === "admin") return true;

  const label = permissionSlugToLabel(permissionSlug);
  if (!label) return false;

  const settings = await Settings.findOne({ organization });
  const configuredPermissions = settings?.permissions || {};
  const storedPermissionValue = configuredPermissions[label]?.[user.role];

  if (storedPermissionValue !== undefined) {
    return Boolean(storedPermissionValue);
  }

  const defaultPermissionValue = DEFAULT_PERMISSIONS[label]?.[user.role];
  return Boolean(defaultPermissionValue);
};
