import { Router } from "express";
import {
  getTeamMembers,
  getUser,
  createTeamMember,
  updateUser,
  updateUserRole,
  updateUserPermissions,
  deleteUser,
  getTeamStats,
  getMyProfile,
  updateMyProfile,
} from "../controllers/user.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { checkRole, checkPermission } from "../middleware/rbac.middleware.js";
import { validateRequest } from "../middleware/validation.middleware.js";
import {
  createTeamMemberValidator,
  updateUserValidator,
  updateUserRoleValidator,
  updateUserPermissionsValidator,
  getTeamMembersValidator,
} from "../validators/user.validator.js";

const router = Router();

// Apply auth middleware to all routes
router.use(verifyJWT);

// Profile routes
router.get("/profile/me", getMyProfile);
router.put("/profile/me", updateMyProfile);

// GET routes
router.get(
  "/",
  validateRequest(getTeamMembersValidator, "query"),
  getTeamMembers,
);

router.get("/stats/summary", getTeamStats);

router.get("/:id", getUser);

// POST routes (Manage users permission required)
router.post(
  "/",
  checkPermission("manage_users"),
  validateRequest(createTeamMemberValidator, "body"),
  createTeamMember,
);

// PUT routes (Admin or self)
router.put("/:id", validateRequest(updateUserValidator, "body"), updateUser);

// PATCH routes (Manage users permission required)
router.patch(
  "/:id/role",
  checkPermission("manage_users"),
  validateRequest(updateUserRoleValidator, "body"),
  updateUserRole,
);

router.patch(
  "/:id/permissions",
  checkPermission("manage_users"),
  validateRequest(updateUserPermissionsValidator, "body"),
  updateUserPermissions,
);

// DELETE routes (Manage users permission required)
router.delete("/:id", checkPermission("manage_users"), deleteUser);

export default router;
