import { Router } from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import {
  getAuthUrl,
  oauthCallback,
  disconnectGcal,
  getGcalStatus,
  listEvents,
  createEvent,
} from "../controllers/googleCalendar.controller.js";
 
const router = Router();
 
// Public — Google posts back here after the consent screen
router.get("/callback", oauthCallback);
 
// All other routes require a logged-in user
router.use(verifyJWT);
 
router.get("/auth-url",    getAuthUrl);
router.post("/disconnect", disconnectGcal);
router.get("/status",      getGcalStatus);
router.get("/events",      listEvents);
router.post("/events",     createEvent);
 
export default router;