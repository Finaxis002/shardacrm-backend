import { Router } from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { checkRole } from "../middleware/rbac.middleware.js";
import {
  getSettings,
  updateSettings,
  exportOrganizationData,
  clearLeads,
  getPipelineStages,
  updatePipelineStages,
} from "../controllers/settings.controller.js";
import { validateRequest } from "../middleware/validation.middleware.js";
import {
  updateSettingsValidator,
  updatePipelineStagesValidator,
} from "../validators/settings.validator.js";

const router = Router();

router.use(verifyJWT);
router.use(checkRole(["admin"]));

router.get("/", getSettings);
router.patch("/", validateRequest(updateSettingsValidator, "body"), updateSettings);
router.get("/pipeline-stages", getPipelineStages);
router.patch(
  "/pipeline-stages",
  validateRequest(updatePipelineStagesValidator, "body"),
  updatePipelineStages,
);
router.get("/export", exportOrganizationData);
router.delete("/clear-leads", clearLeads);

export default router;
