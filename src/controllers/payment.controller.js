import Payment from "../models/Payment.model.js";
import Lead from "../models/Lead.model.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { formatPaginatedResponse, parsePagination } from "../utils/paginate.js";
import logger from "../utils/logger.js";

/**
 * Get all payments
 * @route GET /api/v1/payments
 * @access Private
 */
export const getPayments = asyncHandler(async (req, res) => {
  const { page, limit, status, leadId } = req.query;
  const organization = req.user.organization;

  const filter = { organization };
  if (status) filter.status = status;
  if (leadId) filter.leadId = leadId;

  const {
    skip,
    limit: pageLimit,
    page: pageNum,
  } = parsePagination({
    page,
    limit,
  });

  const payments = await Payment.find(filter)
    .skip(skip)
    .limit(pageLimit)
    .populate("leadId", "name phone email")
    .populate("recordedBy", "name email")
    .sort({ createdAt: -1 })
    .lean();

  const total = await Payment.countDocuments(filter);

  logger.info(`Fetched ${payments.length} payments`);

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        formatPaginatedResponse(payments, total, pageNum, pageLimit),
        "Payments fetched successfully",
      ),
    );
});

/**
 * Get single payment
 * @route GET /api/v1/payments/:id
 * @access Private
 */
export const getPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const organization = req.user.organization;

  const payment = await Payment.findOne({ _id: id, organization })
    .populate("leadId", "name phone email")
    .populate("recordedBy", "name email")
    .lean();

  if (!payment) {
    throw new ApiError(404, "Payment not found");
  }

  res
    .status(200)
    .json(new ApiResponse(200, payment, "Payment fetched successfully"));
});

/**
 * Record payment
 * @route POST /api/v1/payments
 * @access Private
 */
export const recordPayment = asyncHandler(async (req, res) => {
  const {
    leadId,
    amount,
    currency = "INR",
    paymentMode,
    status = "Completed",
    reference,
    paymentDate,
    dueDate,
    description,
  } = req.body;

  const organization = req.user.organization;
  const recordedBy = req.user._id;

  // Validate lead exists
  const lead = await Lead.findOne({ _id: leadId, organization });
  if (!lead) {
    throw new ApiError(404, "Lead not found");
  }

  const payment = new Payment({
    leadId,
    amount,
    currency,
    paymentMode,
    status,
    reference,
    paymentDate: paymentDate || new Date(),
    dueDate,
    description,
    recordedBy,
    organization,
  });

  await payment.save();
  await payment.populate("leadId", "name phone");
  await payment.populate("recordedBy", "name email");

  logger.info(`Payment recorded: ${payment._id} for lead ${leadId}`);

  res
    .status(201)
    .json(new ApiResponse(201, payment, "Payment recorded successfully"));
});

/**
 * Update payment
 * @route PUT /api/v1/payments/:id
 * @access Private
 */
export const updatePayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const organization = req.user.organization;

  const payment = await Payment.findOne({ _id: id, organization });
  if (!payment) {
    throw new ApiError(404, "Payment not found");
  }

  Object.assign(payment, req.body);
  await payment.save();
  await payment.populate("leadId", "name phone");
  await payment.populate("recordedBy", "name email");

  logger.info(`Payment updated: ${id}`);

  res
    .status(200)
    .json(new ApiResponse(200, payment, "Payment updated successfully"));
});

/**
 * Delete payment
 * @route DELETE /api/v1/payments/:id
 * @access Private
 */
export const deletePayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const organization = req.user.organization;

  const payment = await Payment.findOne({ _id: id, organization });
  if (!payment) {
    throw new ApiError(404, "Payment not found");
  }

  await Payment.findByIdAndDelete(id);

  logger.info(`Payment deleted: ${id}`);

  res
    .status(200)
    .json(new ApiResponse(200, null, "Payment deleted successfully"));
});

/**
 * Generate payment link (Razorpay/Stripe)
 * @route POST /api/v1/payments/:id/generate-link
 * @access Private
 */
export const generatePaymentLink = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { description } = req.body;
  const organization = req.user.organization;

  const payment = await Payment.findOne({ _id: id, organization });
  if (!payment) {
    throw new ApiError(404, "Payment not found");
  }

  // TODO: Integrate with Razorpay/Stripe API
  // For now, generate mock link
  const mockLink = `https://payment.example.com/link/${payment._id}`;

  payment.paymentLinkUrl = mockLink;
  payment.paymentLinkExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  await payment.save();

  logger.info(`Payment link generated for payment ${id}`);

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { paymentLink: mockLink, expiryDate: payment.paymentLinkExpiry },
        "Payment link generated successfully",
      ),
    );
});

/**
 * Get payment statistics
 * @route GET /api/v1/payments/stats/overview
 * @access Private
 */
export const getPaymentStats = asyncHandler(async (req, res) => {
  const organization = req.user.organization;

  const stats = await Payment.aggregate([
    { $match: { organization } },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        totalAmount: { $sum: "$amount" },
      },
    },
  ]);

  const totalPayments = await Payment.countDocuments({ organization });
  const totalAmount = await Payment.aggregate([
    { $match: { organization } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        total: totalPayments,
        totalAmount: totalAmount[0]?.total || 0,
        byStatus: stats,
      },
      "Payment statistics fetched successfully",
    ),
  );
});
