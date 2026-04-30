import { Router } from "express";
import {
  getActivities,
  getActivity,
  createActivity,
  updateActivity,
  deleteActivity,
  getLeadActivities,
} from "../controllers/activity.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { validateRequest } from "../middleware/validation.middleware.js";
import {
  createActivityValidator,
  updateActivityValidator,
  getActivitiesValidator,
} from "../validators/activity.validator.js";

const router = Router();

// Apply auth middleware to all routes
router.use(verifyJWT);

// GET routes
router.get(
  "/",
  validateRequest(getActivitiesValidator, "query"),
  getActivities,
);

router.get("/lead/:leadId", getLeadActivities);

router.get("/:id", getActivity);

// POST routes
router.post(
  "/",
  validateRequest(createActivityValidator, "body"),
  createActivity,
);

// PUT routes
router.put(
  "/:id",
  validateRequest(updateActivityValidator, "body"),
  updateActivity,
);

// DELETE routes
router.delete("/:id", deleteActivity);

export default router;
