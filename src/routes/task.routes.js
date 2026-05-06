import express from "express";
import { getTasks, createTask, completeTask, deleteTask } from "../controllers/task.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

const router = express.Router();
router.use(verifyJWT);

router.get("/", getTasks);
router.post("/", createTask);
router.put("/:taskId/complete", completeTask);
router.delete("/:taskId", deleteTask);

export default router;