import { Router } from "express";
import {
  getNotifications,
  getNotification,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  deleteAllNotifications,
  getUnreadCount,
  createNotification,
} from "../controllers/notification.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { validateRequest } from "../middleware/validation.middleware.js";
import {
  getNotificationsValidator,
  createNotificationValidator,
} from "../validators/notification.validator.js";

const router = Router();

// Apply auth middleware to all routes
router.use(verifyJWT);

// GET routes
router.get(
  "/",
  validateRequest(getNotificationsValidator, "query"),
  getNotifications,
);

router.get("/unread/count", getUnreadCount);

router.get("/:id", getNotification);

// POST routes
router.post(
  "/",
  validateRequest(createNotificationValidator, "body"),
  createNotification,
);

// PATCH routes
router.patch("/:id/read", markNotificationAsRead);

router.patch("/read-all", markAllNotificationsAsRead);

// DELETE routes
router.delete("/:id", deleteNotification);

router.delete("/clear-all", deleteAllNotifications);

export default router;
