import { Router } from "express";
import {
  register,
  login,
  logout,
  getCurrentUser,
  refreshToken,
} from "../controllers/auth.controller.js";
import { verifyJWT, refreshAccessToken } from "../middleware/auth.middleware.js";

const router = Router();

// Registration disabled - only admin login allowed
// router.post("/register", register);

router.post("/login", login);
router.post("/refresh", refreshAccessToken, refreshToken);
router.post("/logout", verifyJWT, logout);
router.get("/me", verifyJWT, getCurrentUser);

export default router;
