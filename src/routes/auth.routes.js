import { Router } from "express";
import {
  register,
  login,
  logout,
  getCurrentUser,
} from "../controllers/auth.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

const router = Router();

// Registration disabled - only admin login allowed
// router.post("/register", register);

router.post("/login", login);
router.post("/logout", verifyJWT, logout);
router.get("/me", verifyJWT, getCurrentUser);

export default router;
