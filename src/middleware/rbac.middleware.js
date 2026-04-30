import { ROLE_HIERARCHY } from "../constants/roles.js";
import ApiError from "../utils/apiError.js";

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
  return (req, res, next) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication required");
    }

    // Admin always has permission
    if (req.user.role === "admin") {
      return next();
    }

    // Check if user has the permission
    if (req.user.permissions && req.user.permissions.includes(permissionName)) {
      return next();
    }

    throw new ApiError(403, `You don't have permission to: ${permissionName}`);
  };
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
