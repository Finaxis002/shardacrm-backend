import Notification from "../models/Notification.model.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { formatPaginatedResponse, parsePagination } from "../utils/paginate.js";
import logger from "../utils/logger.js";

/**
 * Get all notifications for user
 * @route GET /api/v1/notifications
 * @access Private
 */
export const getNotifications = asyncHandler(async (req, res) => {
  const { page, limit, isRead } = req.query;
  const userId = req.user._id;
  const organization = req.user.organization;

  const filter = { recipientId: userId, organization };

  if (isRead !== undefined) {
    filter.isRead = isRead === "true";
  }

  const {
    skip,
    limit: pageLimit,
    page: pageNum,
  } = parsePagination({
    page,
    limit,
  });

  const notifications = await Notification.find(filter)
    .skip(skip)
    .limit(pageLimit)
    .populate("senderId", "name email avatar")
    .populate("leadId", "name phone")
    .sort({ createdAt: -1 })
    .lean();

  const total = await Notification.countDocuments(filter);
  const unreadCount = await Notification.countDocuments({
    recipientId: userId,
    organization,
    isRead: false,
  });

  logger.info(
    `Fetched ${notifications.length} notifications for user ${userId}`,
  );

  res.status(200).json(
    new ApiResponse(
      200,
      {
        ...formatPaginatedResponse(notifications, total, pageNum, pageLimit),
        unreadCount,
      },
      "Notifications fetched successfully",
    ),
  );
});

/**
 * Get single notification
 * @route GET /api/v1/notifications/:id
 * @access Private
 */
export const getNotification = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;
  const organization = req.user.organization;

  const notification = await Notification.findOne({
    _id: id,
    recipientId: userId,
    organization,
  })
    .populate("senderId", "name email avatar")
    .populate("leadId", "name phone")
    .lean();

  if (!notification) {
    throw new ApiError(404, "Notification not found");
  }

  res
    .status(200)
    .json(
      new ApiResponse(200, notification, "Notification fetched successfully"),
    );
});

/**
 * Mark notification as read
 * @route PATCH /api/v1/notifications/:id/read
 * @access Private
 */
export const markNotificationAsRead = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;
  const organization = req.user.organization;

  const notification = await Notification.findOne({
    _id: id,
    recipientId: userId,
    organization,
  });

  if (!notification) {
    throw new ApiError(404, "Notification not found");
  }

  notification.isRead = true;
  notification.readAt = new Date();
  await notification.save();

  logger.info(`Notification marked as read: ${id}`);

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        notification,
        "Notification marked as read successfully",
      ),
    );
});

/**
 * Mark all notifications as read
 * @route PATCH /api/v1/notifications/read-all
 * @access Private
 */
export const markAllNotificationsAsRead = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const organization = req.user.organization;

  await Notification.updateMany(
    { recipientId: userId, organization, isRead: false },
    { isRead: true, readAt: new Date() },
  );

  logger.info(`All notifications marked as read for user ${userId}`);

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        null,
        "All notifications marked as read successfully",
      ),
    );
});

/**
 * Delete notification
 * @route DELETE /api/v1/notifications/:id
 * @access Private
 */
export const deleteNotification = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;
  const organization = req.user.organization;

  const notification = await Notification.findOne({
    _id: id,
    recipientId: userId,
    organization,
  });

  if (!notification) {
    throw new ApiError(404, "Notification not found");
  }

  await Notification.findByIdAndDelete(id);

  logger.info(`Notification deleted: ${id}`);

  res
    .status(200)
    .json(new ApiResponse(200, null, "Notification deleted successfully"));
});

/**
 * Delete all notifications
 * @route DELETE /api/v1/notifications/clear-all
 * @access Private
 */
export const deleteAllNotifications = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const organization = req.user.organization;

  await Notification.deleteMany({ recipientId: userId, organization });

  logger.info(`All notifications deleted for user ${userId}`);

  res
    .status(200)
    .json(new ApiResponse(200, null, "All notifications deleted successfully"));
});

/**
 * Get unread count
 * @route GET /api/v1/notifications/unread/count
 * @access Private
 */
export const getUnreadCount = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const organization = req.user.organization;

  const count = await Notification.countDocuments({
    recipientId: userId,
    organization,
    isRead: false,
  });

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { unreadCount: count },
        "Unread count fetched successfully",
      ),
    );
});

/**
 * Create notification (Internal use)
 * @route POST /api/v1/notifications
 * @access Private (Backend only)
 */
export const createNotification = asyncHandler(async (req, res) => {
  const { recipientId, senderId, leadId, title, message, type, actionUrl } =
    req.body;

  const organization = req.user.organization;

  const notification = new Notification({
    recipientId,
    senderId,
    leadId,
    title,
    message,
    type,
    actionUrl,
    organization,
  });

  await notification.save();

  logger.info(`Notification created: ${notification._id}`);

  res
    .status(201)
    .json(
      new ApiResponse(201, notification, "Notification created successfully"),
    );
});
