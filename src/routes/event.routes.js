import { Router } from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import {
  getEvents,
  createEvent,
  getEventById,
  updateEvent,
  markEventDone,
  deleteEvent,
} from "../controllers/event.controller.js";

const router = Router();

// All event routes require authentication
router.use(verifyJWT);

router.get("/",        getEvents);
router.post("/",       createEvent);
router.get("/:id",     getEventById);
router.patch("/:id",   updateEvent);
router.patch("/:id/done", markEventDone);   // ← what the frontend calls
router.delete("/:id",  deleteEvent);

export default router;