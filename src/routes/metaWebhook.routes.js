import { Router } from "express";
import {
  verifyWebhook,
  receiveWebhook,
} from "../controllers/metaWebhook.controller.js";

const router = Router();



// Meta webhook verification + receive
router.get("/webhook", verifyWebhook);

// Raw body middleware — signature verification ke liye
router.post(
  "/webhook",
  (req, res, next) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      req.rawBody = data;
      // Body already parsed by express.json — rawBody sirf signature check ke liye
      next();
    });
  },
  receiveWebhook
);



export default router;