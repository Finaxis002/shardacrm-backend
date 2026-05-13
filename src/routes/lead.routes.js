import { Router } from "express";
import {
  getLeads,
  getLead,
  createLead,
  updateLead,
  deleteLead,
  updateLeadStatus,
  assignLead,
  addCoAssignee,
  removeCoAssignee,
  getLeadStats,
  bulkAssignLeads,
  bulkDeleteLeads,
  getLeadIds
} from "../controllers/lead.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { checkPermission } from "../middleware/rbac.middleware.js";
import { validateRequest } from "../middleware/validation.middleware.js";
import {
  createLeadValidator,
  updateLeadValidator,
  assignLeadValidator,
  updateLeadStatusValidator,
  searchLeadsValidator,
} from "../validators/lead.validator.js";

const router = Router();

// Apply auth middleware to all routes
router.use(verifyJWT);
router.delete("/bulk", bulkDeleteLeads);
router.patch("/bulk/assign", bulkAssignLeads);
router.get("/ids", getLeadIds);
// GET routes
router.get("/", validateRequest(searchLeadsValidator, "query"), getLeads);

router.get("/stats/overview", getLeadStats);

router.get("/:id", getLead);

// POST routes
router.post(
  "/",
  checkPermission("add_leads"),
  validateRequest(createLeadValidator, "body"),
  createLead,
);

router.post(
  "/:id/co-assignees",
  checkPermission("assign_leads"),
  addCoAssignee,
);

// PUT routes
router.put(
  "/:id",
  validateRequest(updateLeadValidator, "body"),
  updateLead,
);

// PATCH routes
router.patch(
  "/:id/status",
  validateRequest(updateLeadStatusValidator, "body"),
  updateLeadStatus,
);

router.patch(
  "/:id/assign",
  checkPermission("assign_leads"),
  validateRequest(assignLeadValidator, "body"),
  assignLead,
);

// DELETE routes
router.delete("/:id", checkPermission("delete_leads"), deleteLead);

router.delete(
  "/:id/co-assignees/:userId",
  checkPermission("assign_leads"),
  removeCoAssignee,
);

export default router;
