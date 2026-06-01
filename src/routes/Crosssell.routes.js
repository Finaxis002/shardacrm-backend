import { Router } from "express";
import {
  getRecommendations,
  respondToRecommendation,
  sendAutomation,
  getDashboard,
  getRules,
  updateRule,
  createRule,
  scheduleEmail,
  getScheduledEmails,
  cancelScheduledEmail,
  getLeadsOverview,
  getSuccessLeads,     
  assignServices, 
  deleteRule,
} from "../controllers/Crosssell.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

const router = Router();
router.use(verifyJWT);

router.get("/recommendations/:leadId", getRecommendations);
router.post("/respond", respondToRecommendation);
router.post("/send-automation/:leadId", sendAutomation);
router.post("/schedule-email/:leadId", scheduleEmail);
router.get("/scheduled-emails/:leadId", getScheduledEmails);
router.delete("/scheduled-emails/:emailId", cancelScheduledEmail);
router.delete("/rules/:ruleId", deleteRule);
router.get("/dashboard", getDashboard);
router.get("/leads-overview", getLeadsOverview);
router.get("/rules", getRules);
router.post("/rules", createRule);
router.put("/rules/:ruleId", updateRule);
router.get("/success-leads", getSuccessLeads);        
router.post("/assign-services/:leadId", assignServices);
export default router;
