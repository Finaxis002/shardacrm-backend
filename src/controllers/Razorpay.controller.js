import Razorpay from "razorpay";
import crypto from "crypto";
import Payment from "../models/Payment.model.js";
import Lead from "../models/Lead.model.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import logger from "../utils/logger.js";

// ─── Razorpay instance ────────────────────────────────────────────────────────
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Create Razorpay Order
 * @route POST /api/v1/payments/razorpay/create-order
 * @access Private
 */
export const createRazorpayOrder = asyncHandler(async (req, res) => {
  const { leadId, amount, currency = "INR", description, dueDate } = req.body;
  const organization = req.user.organization;
  const recordedBy = req.user._id;

  if (!leadId || !amount || amount <= 0) {
    throw new ApiError(400, "leadId and valid amount are required");
  }

  // Validate lead
  const lead = await Lead.findOne({ _id: leadId, organization });
  if (!lead) {
    throw new ApiError(404, "Lead not found");
  }

  // Create Razorpay order (amount in paise)
  const razorpayOrder = await razorpay.orders.create({
    amount: Math.round(amount * 100),
    currency,
    receipt: `receipt_${Date.now()}`,
    notes: {
      leadId: leadId.toString(),
      description: description || "",
      organization: organization.toString(),
    },
  });

  // Save pending payment in DB
  const payment = new Payment({
    leadId,
    amount,
    currency,
    paymentMode: "Razorpay",
    status: "Pending",
    description,
    dueDate: dueDate || undefined,
    gateway: "Razorpay",
    gatewayTransactionId: razorpayOrder.id,
    recordedBy,
    organization,
    metadata: { razorpayOrderId: razorpayOrder.id },
  });

  await payment.save();
  await payment.populate("leadId", "name phone email");

  logger.info(`Razorpay order created: ${razorpayOrder.id} for lead ${leadId}`);

  res.status(201).json(
    new ApiResponse(
      201,
      {
        payment,
        razorpayOrder,
        razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      },
      "Razorpay order created successfully",
    ),
  );
});

/**
 * Verify Razorpay Payment
 * @route POST /api/v1/payments/razorpay/verify
 * @access Private
 */
export const verifyRazorpayPayment = asyncHandler(async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    paymentId,
  } = req.body;

  if (
    !razorpay_order_id ||
    !razorpay_payment_id ||
    !razorpay_signature ||
    !paymentId
  ) {
    throw new ApiError(400, "All Razorpay fields are required");
  }

  // Verify signature
  const generatedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (generatedSignature !== razorpay_signature) {
    throw new ApiError(400, "Invalid payment signature");
  }

  // Update payment in DB
  const payment = await Payment.findById(paymentId);
  if (!payment) {
    throw new ApiError(404, "Payment record not found");
  }

  payment.status = "Paid";
  payment.gatewayTransactionId = razorpay_payment_id;
  payment.paymentDate = new Date();
  payment.reference = razorpay_payment_id;
  payment.metadata = {
    ...payment.metadata,
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
  };

  await payment.save();
  await payment.populate("leadId", "name phone email");
  await payment.populate("recordedBy", "name email");

  logger.info(`Razorpay payment verified: ${razorpay_payment_id}`);

  res
    .status(200)
    .json(new ApiResponse(200, payment, "Payment verified successfully"));
});

/**
 * Razorpay Webhook Handler
 * @route POST /api/v1/payments/razorpay/webhook
 * @access Public (No JWT - Razorpay calls this)
 */
export const handleRazorpayWebhook = asyncHandler(async (req, res) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers["x-razorpay-signature"];

  // Verify webhook signature using raw body
  const rawBody = req.rawBody || JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  if (signature !== expectedSignature) {
    logger.warn("Invalid Razorpay webhook signature");
    throw new ApiError(400, "Invalid webhook signature");
  }

  const event = req.body.event;
  const payload = req.body.payload;

  logger.info(`Razorpay webhook received: ${event}`);

  if (event === "payment.captured") {
    const razorpayPayment = payload.payment?.entity;
    const orderId = razorpayPayment?.order_id;

    if (orderId) {
      const payment = await Payment.findOne({
        "metadata.razorpayOrderId": orderId,
      });

      if (payment && payment.status !== "Paid") {
        payment.status = "Paid";
        payment.gatewayTransactionId = razorpayPayment.id;
        payment.paymentDate = new Date(razorpayPayment.created_at * 1000);
        payment.reference = razorpayPayment.id;
        payment.metadata = {
          ...payment.metadata,
          webhookData: razorpayPayment,
        };
        await payment.save();
        logger.info(`Payment updated via webhook: ${payment._id}`);
      }
    }
  }

  if (event === "payment.failed") {
    const razorpayPayment = payload.payment?.entity;
    const orderId = razorpayPayment?.order_id;

    if (orderId) {
      const payment = await Payment.findOne({
        "metadata.razorpayOrderId": orderId,
      });

      if (payment && payment.status === "Pending") {
        payment.status = "Cancelled";
        payment.metadata = {
          ...payment.metadata,
          failureReason: razorpayPayment?.error_description,
        };
        await payment.save();
        logger.info(`Payment marked failed via webhook: ${payment._id}`);
      }
    }
  }

  // Always return 200 to Razorpay quickly
  res.status(200).json({ received: true });
});

/**
 * Generate Razorpay Payment Link (REAL)
 * @route POST /api/v1/payments/:id/generate-link
 * @access Private
 */
export const generateRazorpayPaymentLink = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { description } = req.body;
  const organization = req.user.organization;

  const payment = await Payment.findOne({ _id: id, organization }).populate(
    "leadId",
    "name phone email",
  );

  if (!payment) {
    throw new ApiError(404, "Payment not found");
  }

  const lead = payment.leadId;

  // Create real Razorpay Payment Link
  const paymentLink = await razorpay.paymentLink.create({
    amount: Math.round(payment.amount * 100), // paise mein
    currency: payment.currency || "INR",
    accept_partial: false,
    description: description || payment.description || "Payment",
    customer: {
      name: lead?.name || "",
      email: lead?.email || "",
      contact: lead?.phone || "",
    },
    notify: {
      sms: !!lead?.phone,
      email: !!lead?.email,
    },
    reminder_enable: true,
    notes: {
      paymentId: payment._id.toString(),
      leadId: lead?._id?.toString() || "",
    },
    expire_by: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days
  });

  // Save link details in DB
  payment.paymentLinkId = paymentLink.id;
  payment.paymentLinkUrl = paymentLink.short_url;
  payment.paymentLinkExpiry = new Date(paymentLink.expire_by * 1000);
  payment.metadata = {
    ...payment.metadata,
    paymentLinkId: paymentLink.id,
  };
  await payment.save();

  logger.info(`Razorpay payment link generated: ${paymentLink.short_url}`);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        paymentLink: paymentLink.short_url,
        linkId: paymentLink.id,
        expiryDate: payment.paymentLinkExpiry,
      },
      "Payment link generated successfully",
    ),
  );
});

/**
 * Razorpay Connection Status
 * @route GET /api/v1/integrations/razorpay/status
 * @access Private
 */
export const getRazorpayStatus = asyncHandler(async (req, res) => {
  const connected =
    !!process.env.RAZORPAY_KEY_ID && !!process.env.RAZORPAY_KEY_SECRET;

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { connected },
        connected ? "Razorpay is connected" : "Razorpay is not configured",
      ),
    );
});
