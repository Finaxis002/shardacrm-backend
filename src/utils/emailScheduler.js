import cron from "node-cron";
import { ScheduledEmail } from "../models/CrossSell.model.js";
import sendEmail from "./sendEmail.js";

const startEmailScheduler = () => {
  // Har minute check karo
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();

      // Pending emails jo schedule time aa gayi ho
      const dueMails = await ScheduledEmail.find({
        status: "pending",
        scheduledAt: { $lte: now },
      }).limit(20);

      for (const mail of dueMails) {
        try {
          await sendEmail({
            to: mail.to,
            subject: mail.subject,
            html: mail.html,
          });

          mail.status = "sent";
          mail.sentAt = new Date();
          await mail.save();

          console.log(`✅ Scheduled email sent to ${mail.to}`);
        } catch (err) {
          mail.status = "failed";
          mail.error = err.message;
          await mail.save();
          console.error(`❌ Failed to send scheduled email to ${mail.to}:`, err.message);
        }
      }
    } catch (err) {
      console.error("Email scheduler error:", err.message);
    }
  });

  console.log("📅 Email scheduler started — checking every minute");
};

export default startEmailScheduler;