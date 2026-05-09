import { Router } from "express";
import { getRazorpayStatus } from "../controllers/razorpay.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

const router = Router();

router.use(verifyJWT);

// GET /api/v1/integrations/razorpay/status
router.get("/razorpay/status", getRazorpayStatus);

export default router;