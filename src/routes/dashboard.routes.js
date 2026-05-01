import { Router } from "express";
import { getDashboardOverview } from "../controllers/dashboard.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

const router = Router();
router.use(verifyJWT);
router.get("/overview", getDashboardOverview);

export default router;
