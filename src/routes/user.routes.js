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
import { checkRole } from "../middleware/rbac.middleware.js";
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

// POST routes (Admin only)
router.post(
  "/",
  checkRole(["admin"]),
  validateRequest(createTeamMemberValidator, "body"),
  createTeamMember,
);

// PUT routes (Admin or self)
router.put("/:id", validateRequest(updateUserValidator, "body"), updateUser);

// PATCH routes (Admin only)
router.patch(
  "/:id/role",
  checkRole(["admin"]),
  validateRequest(updateUserRoleValidator, "body"),
  updateUserRole,
);

router.patch(
  "/:id/permissions",
  checkRole(["admin"]),
  validateRequest(updateUserPermissionsValidator, "body"),
  updateUserPermissions,
);

// DELETE routes (Admin only)
router.delete("/:id", checkRole(["admin"]), deleteUser);

export default router;
