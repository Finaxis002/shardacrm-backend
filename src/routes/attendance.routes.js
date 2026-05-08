import express from "express";
import { protect } from "../middleware/auth.middleware.js";
import { adminOnly } from "../middleware/roleMiddleware.js";
import * as ctrl from "../controllers/attendance.controller.js";

const router = express.Router();

router.post("/mark",                protect,            ctrl.markAttendance);
router.get("/my",                   protect,            ctrl.myAttendance);

// OTP routes
router.post("/otp/request",         protect,            ctrl.requestAttendanceOtp);
router.post("/otp/verify",          protect,            ctrl.verifyAttendanceOtp);

router.get("/admin/users",          protect, adminOnly, ctrl.getAllUsers);
router.get("/admin/monthly",        protect, adminOnly, ctrl.adminMonthly);
router.get("/admin/day",            protect, adminOnly, ctrl.adminDayDetail);
router.get("/admin/user/:userId",   protect, adminOnly, ctrl.adminUserMonthly);
router.post("/admin/manual",        protect, adminOnly, ctrl.adminManualMark);

export default router;