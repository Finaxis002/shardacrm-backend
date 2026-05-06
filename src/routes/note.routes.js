import express from "express";
import { getNotes, createNote, updateNote, deleteNote } from "../controllers/note.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

const router = express.Router();
router.use(verifyJWT);

router.get("/", getNotes);
router.post("/", createNote);
router.put("/:noteId", updateNote);
router.delete("/:noteId", deleteNote);

export default router;