import cron from "node-cron";
import { CrossSellLead } from "../models/Crosssell.model.js";
import Lead from "../models/Lead.model.js";
import Activity from "../models/Activity.model.js";

export const startReactivationCron = () => {
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();
      const windowStart = new Date(now.getTime() - 60000); // 1 min pehle

      const records = await CrossSellLead.find({
        reactivationDate: { $gte: windowStart, $lte: now },
        reactivationDone: false,
      });

      for (const record of records) {
        await Lead.findByIdAndUpdate(record.leadId, { 
          status: "New",
          isCrossSell: true,
        });
        await Activity.create({
          leadId: record.leadId,
          organization: record.organization,
          type: "Note",
          text: `🔁 Lead "New" me reactivate hua — ${(record.reactivationServices || []).join(", ")}`,
          createdBy: record.assignedTo,
        });
        record.reactivationDone = true;
        await record.save();
      }
    } catch (err) {
      console.error("Reactivation cron error:", err.message);
    }
  });
};  