import { Router } from "express";
import {
  getPayments,
  getPayment,
  recordPayment,
  updatePayment,
  deletePayment,
  getPaymentStats,
} from "../controllers/payment.controller.js";

import {
  createRazorpayOrder,
  verifyRazorpayPayment,
  handleRazorpayWebhook,
  generateRazorpayPaymentLink,
} from "../controllers/razorpay.controller.js";

import { verifyJWT } from "../middleware/auth.middleware.js";
import { checkPermission } from "../middleware/rbac.middleware.js";
import { validateRequest } from "../middleware/validation.middleware.js";
import {
  createPaymentValidator,
  updatePaymentValidator,
  generatePaymentLinkValidator,
  getPaymentsValidator,
} from "../validators/payment.validator.js";

const router = Router();

// ─── PUBLIC ROUTE (No JWT) ────────────────────────────────────────────────────
// Razorpay calls this directly — NO auth middleware
router.post("/razorpay/webhook", handleRazorpayWebhook);

// ─── Apply JWT auth to all routes below ──────────────────────────────────────
router.use(verifyJWT);

// ─── Razorpay routes ──────────────────────────────────────────────────────────
router.post(
  "/razorpay/create-order",
  checkPermission("record_payments"),
  createRazorpayOrder,
);

router.post(
  "/razorpay/verify",
  checkPermission("record_payments"),
  verifyRazorpayPayment,
);

// ─── Existing GET routes ──────────────────────────────────────────────────────
router.get("/", validateRequest(getPaymentsValidator, "query"), getPayments);

router.get("/stats/overview", getPaymentStats);

router.get("/:id", getPayment);

// ─── Existing POST routes ─────────────────────────────────────────────────────
router.post(
  "/",
  checkPermission("record_payments"),
  validateRequest(createPaymentValidator, "body"),
  recordPayment,
);

router.post(
  "/:id/generate-link",
  checkPermission("record_payments"),
  validateRequest(generatePaymentLinkValidator, "body"),
  generateRazorpayPaymentLink, // ← replaced mock with real
);

// ─── Existing PUT routes ──────────────────────────────────────────────────────
router.put(
  "/:id",
  checkPermission("record_payments"),
  validateRequest(updatePaymentValidator, "body"),
  updatePayment,
);

// ─── Existing DELETE routes ───────────────────────────────────────────────────
router.delete("/:id", checkPermission("record_payments"), deletePayment);

export default router;