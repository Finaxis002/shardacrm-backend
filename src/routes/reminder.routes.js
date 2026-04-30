import { Router } from "express";
import {
  getReminders,
  getReminder,
  createReminder,
  updateReminder,
  deleteReminder,
  markReminderDone,
  getTodayReminders,
} from "../controllers/reminder.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { validateRequest } from "../middleware/validation.middleware.js";
import {
  createReminderValidator,
  updateReminderValidator,
  getRemindersValidator,
  markReminderDoneValidator,
} from "../validators/reminder.validator.js";

const router = Router();

// Apply auth middleware to all routes
router.use(verifyJWT);

// GET routes
router.get("/", validateRequest(getRemindersValidator, "query"), getReminders);

router.get("/today/pending", getTodayReminders);

router.get("/:id", getReminder);

// POST routes
router.post(
  "/",
  validateRequest(createReminderValidator, "body"),
  createReminder,
);

// PUT routes
router.put(
  "/:id",
  validateRequest(updateReminderValidator, "body"),
  updateReminder,
);

// PATCH routes
router.patch(
  "/:id/done",
  validateRequest(markReminderDoneValidator, "body"),
  markReminderDone,
);

// DELETE routes
router.delete("/:id", deleteReminder);

export default router;
