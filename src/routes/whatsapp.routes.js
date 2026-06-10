import { Router } from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import {
  getWhatsAppMessages,
  sendWhatsAppMessage,
  updateWhatsAppMessage,
  deleteWhatsAppMessage,
  verifyWebhook,
  receiveWebhook,
} from "../controllers/whatsapp.controller.js";

const router = Router();

router.get("/messages", verifyJWT, getWhatsAppMessages);
router.post("/send", verifyJWT, sendWhatsAppMessage);
router.patch("/messages/:id", verifyJWT, updateWhatsAppMessage);
router.delete("/messages/:id", verifyJWT, deleteWhatsAppMessage);
router.get("/webhook", verifyWebhook);
router.post("/webhook", receiveWebhook);

export default router;
