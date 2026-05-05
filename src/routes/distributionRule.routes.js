import express from "express";
import {
  getRules,
  createRule,
  updateRule,
  deleteRule,
} from "../controllers/distributionRule.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

const router = express.Router();
router.use(verifyJWT);

router.get("/", getRules);
router.post("/", createRule);
router.put("/:id", updateRule);
router.delete("/:id", deleteRule);

export default router;