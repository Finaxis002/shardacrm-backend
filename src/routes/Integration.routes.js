import { Router } from "express";
import {
  getRazorpayStatus,
  connectRazorpay,
  disconnectRazorpay,
} from "../controllers/razorpay.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

const router = Router();

router.use(verifyJWT);

// GET  /api/v1/integrations/razorpay/status
router.get("/razorpay/status", getRazorpayStatus);

// POST /api/v1/integrations/razorpay/connect
router.post("/razorpay/connect", connectRazorpay);

// POST /api/v1/integrations/razorpay/disconnect
router.post("/razorpay/disconnect", disconnectRazorpay);

export default router;