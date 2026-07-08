import { Router } from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { uploadWhatsappMedia } from "../middleware/whatsappUpload.middleware.js";
import {
  getWhatsAppMessages,
  sendWhatsAppMessage,
  sendWhatsAppMedia,
  updateWhatsAppMessage,
  deleteWhatsAppMessage,
  verifyWebhook,
  receiveWebhook,
  logoutWhatsApp, 
  connectWhatsApp,
  getWhatsAppStatus,
  getUnreadCounts,
  markMessagesRead,
  sendTypingStatus,
  subscribePresence, 
} from "../controllers/whatsapp.controller.js";

const router = Router();

router.get("/messages", verifyJWT, getWhatsAppMessages);
router.post("/send", verifyJWT, sendWhatsAppMessage);
router.post("/send-media", verifyJWT, uploadWhatsappMedia, sendWhatsAppMedia);   // ⬅️ NAYA
router.patch("/messages/:id", verifyJWT, updateWhatsAppMessage);
router.delete("/messages/:id", verifyJWT, deleteWhatsAppMessage);
router.post("/logout", verifyJWT, logoutWhatsApp);  
router.post("/connect", verifyJWT, connectWhatsApp);       // ⬅️ NAYA
router.get("/status", verifyJWT, getWhatsAppStatus);
router.post("/unread-counts", verifyJWT, getUnreadCounts);
router.patch("/mark-read/:leadId", verifyJWT, markMessagesRead);
router.post("/typing", verifyJWT, sendTypingStatus);   // ⬅️ NAYA
router.post("/subscribe-presence", verifyJWT, subscribePresence);
router.get("/webhook", verifyWebhook);
router.post("/webhook", receiveWebhook);

export default router;