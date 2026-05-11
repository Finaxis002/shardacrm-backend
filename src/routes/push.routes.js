import { Router } from "express";
import PushSubscription from "../models/PushSubscription.model.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/apiError.js";

const router = Router();

router.use(verifyJWT);

const saveSubscription = asyncHandler(async (req, res) => {
  const { subscription } = req.body;

  if (
    !subscription ||
    !subscription.endpoint ||
    !subscription.keys?.auth ||
    !subscription.keys?.p256dh
  ) {
    throw new ApiError(400, "Invalid push subscription payload");
  }

  const expirationTime = subscription.expirationTime
    ? new Date(subscription.expirationTime)
    : null;

  const savedSubscription = await PushSubscription.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    {
      user: req.user._id,
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      expirationTime,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  res.status(200).json({
    success: true,
    data: savedSubscription,
    message: "Push subscription saved successfully.",
  });
});

router.post("/save-subscription", saveSubscription);

export default router;
