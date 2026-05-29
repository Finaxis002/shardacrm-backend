import cron from "node-cron";
import { ScheduledEmail } from "../models/Crosssell.model.js";
import sendEmail from "./sendEmail.js";

const startEmailScheduler = () => {
  let isRunning = false; // ← In-process lock

  cron.schedule("* * * * *", async () => {
    
    
    if (isRunning) {
      console.log("⏭️ Scheduler already running, skipping this tick");
      return;
    }
    isRunning = true;

    try {
      const now = new Date();


      const dueMails = await ScheduledEmail.find({
  status: "pending",
  scheduledAt: { $lte: now },
}); 

      if (dueMails.length === 0) {
        isRunning = false;
        return;
      }

   
      const mailIds = dueMails.map((m) => m._id);
      await ScheduledEmail.updateMany(
        { 
          _id: { $in: mailIds }, 
          status: "pending" 
        },
        { $set: { status: "processing" } }
      );

      
      const lockedMails = await ScheduledEmail.find({
        _id: { $in: mailIds },
        status: "processing",
      });

      console.log(`📬 Processing ${lockedMails.length} scheduled email(s)`);

      for (const mail of lockedMails) {
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
          console.error(`❌ Failed: ${mail.to} —`, err.message);
        }
      }
    } catch (err) {
      console.error("Email scheduler error:", err.message);
    } finally {
      isRunning = false; 
    }
  });

  console.log("📅 Email scheduler started — checking every minute");
};

export default startEmailScheduler;