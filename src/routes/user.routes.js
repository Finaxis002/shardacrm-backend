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
import {
  updateUserAiKeys,
  getUserAiKeys,
} from "../controllers/settings.controller.js";
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

// POST routes
router.post(
  "/",
  checkPermission("manage_users"),
  validateRequest(createTeamMemberValidator, "body"),
  createTeamMember,
);

// PUT routes
router.put("/:id", validateRequest(updateUserValidator, "body"), updateUser);

// PATCH routes
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

// ── AI Keys routes ──
router.get("/:userId/ai-keys", checkPermission("manage_users"), getUserAiKeys);
router.patch(
  "/:userId/ai-keys",
  checkPermission("manage_users"),
  updateUserAiKeys,
);

// DELETE routes
router.delete("/:id", checkPermission("manage_users"), deleteUser);

export default router;
