import { ROLE_HIERARCHY } from "../constants/roles.js";
import ApiError from "../utils/apiError.js";
import asyncHandler from "../utils/asyncHandler.js";
import { canUser, permissionSlugToLabel } from "../utils/permissions.js";

const ROLE_DEFAULT_PERMISSIONS = {
  admin: [
    "add_leads",
    "edit_any_lead",
    "delete_leads",
    "assign_leads",
    "record_payments",
    "view_all_leads",
    "manage_users",
    "admin_panel",
  ],
  manager: [
    "add_leads",
    "assign_leads",
    "record_payments",
    "view_all_leads",
    "view_team",
  ],
  tl: ["add_leads", "assign_leads", "view_team"],
  exec: ["add_leads"],
  viewer: [],
};

export const checkRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication required");
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw new ApiError(403, "Access denied - insufficient permissions");
    }

    next();
  };
};

export const checkPermission = (permissionName) => {
  return asyncHandler(async (req, res, next) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication required");
    }

    if (req.user.role === "admin") {
      return next();
    }

    const permissionLabel = permissionSlugToLabel(permissionName);
    if (!permissionLabel) {
      throw new ApiError(403, `Unsupported permission: ${permissionName}`);
    }

    const hasPermission = await canUser(
      req.user,
      req.user.organization,
      permissionName,
    );
    if (hasPermission) {
      return next();
    }

    throw new ApiError(403, `You don't have permission to: ${permissionName}`);
  });
};

export const checkMinimumRole = (minimumRole) => {
  return (req, res, next) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication required");
    }

    const userHierarchy = ROLE_HIERARCHY[req.user.role] || 0;
    const minimumHierarchy = ROLE_HIERARCHY[minimumRole] || 0;

    if (userHierarchy < minimumHierarchy) {
      throw new ApiError(403, "Insufficient role privileges");
    }

    next();
  };
};
