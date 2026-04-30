import { Router } from "express";
import {
  getPayments,
  getPayment,
  recordPayment,
  updatePayment,
  deletePayment,
  generatePaymentLink,
  getPaymentStats,
} from "../controllers/payment.controller.js";
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

// Apply auth middleware to all routes
router.use(verifyJWT);

// GET routes
router.get("/", validateRequest(getPaymentsValidator, "query"), getPayments);

router.get("/stats/overview", getPaymentStats);

router.get("/:id", getPayment);

// POST routes
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
  generatePaymentLink,
);

// PUT routes
router.put(
  "/:id",
  checkPermission("record_payments"),
  validateRequest(updatePaymentValidator, "body"),
  updatePayment,
);

// DELETE routes
router.delete("/:id", checkPermission("record_payments"), deletePayment);

export default router;
