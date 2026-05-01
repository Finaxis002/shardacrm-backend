import { Router } from "express";
import {
  getConnections,
  registerSheet,
  saveMapping,
  refreshToken,
  deleteConnection,
  getSyncStatus,
} from "../controllers/googleSheets.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { checkPermission } from "../middleware/rbac.middleware.js";

const router = Router();

router.use(verifyJWT);
router.use(checkPermission("import_leads"));

router.get("/connections",              getConnections);
router.post("/register",               registerSheet);
router.put("/:syncId/mapping",         saveMapping);
router.put("/:syncId/token",           refreshToken);
router.delete("/:syncId",              deleteConnection);
router.get("/:syncId/status",          getSyncStatus);

export default router;