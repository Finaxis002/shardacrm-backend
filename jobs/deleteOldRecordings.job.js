import cron from "node-cron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Lead from "../src/models/Lead.model.js";
import CallLog from "../src/models/CallLog.model.js";
import logger from "../src/utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RETENTION_DAYS = 60;

export const deleteOldRecordingsJob = async () => {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const leads = await Lead.find({
    status: "Closed",
    closedAt: { $ne: null, $lte: cutoff },
    recordingsDeletedAt: null,
  });

  for (const lead of leads) {
    try {
      let deletedSomething = false;

      // ── 1. Lead.recordings[] array — manually uploaded recordings ──
      for (const rec of lead.recordings || []) {
        if (!rec.filename) continue;
        const filePath = path.join(
          __dirname, "..", "src", "uploads", "recordings", rec.filename,
        );
        fs.unlink(filePath, (err) => {
          if (err && err.code !== "ENOENT") {
            logger.warn(`Failed to delete ${filePath}: ${err.message}`);
          }
        });
        deletedSomething = true;
      }

      if (lead.recordings?.length || lead.recording?.url) {
        lead.recordings = [];
        lead.recording = { label: "", url: "" };
        deletedSomething = true;
      }

      // ── 2. CallLog — auto-tracked call recordings ──
      const callLogs = await CallLog.find({
        lead: lead._id,
        organization: lead.organization,
        recordingUrl: { $nin: [null, ""] },
      });

      for (const callLog of callLogs) {
        const filename = callLog.recordingUrl.split("/").pop();
        const filePath = path.join(
          __dirname, "..", "src", "uploads", "call-recordings", filename,
        );
        fs.unlink(filePath, (err) => {
          if (err && err.code !== "ENOENT") {
            logger.warn(`Failed to delete ${filePath}: ${err.message}`);
          }
        });

        // Sirf recording file/url clear karo — transcript aur AI summary safe rehne do
        callLog.recordingUrl = "";
        callLog.recordingUploaded = false;
        await callLog.save();
        deletedSomething = true;
      }

      lead.recordingsDeletedAt = new Date();
      await lead.save();

      if (deletedSomething) {
        logger.info(`Auto-deleted recordings for closed lead ${lead._id}`);
      } else {
        logger.info(`No recordings found for closed lead ${lead._id}, marked as checked`);
      }
    } catch (err) {
      logger.error(`Recording cleanup failed for lead ${lead._id}: ${err.message}`);
    }
  }
};

// Roz raat 2 AM IST pe chalega
export const startRecordingCleanupCron = () => {
  cron.schedule("0 2 * * *", () => {
    logger.info("Running recording cleanup cron...");
    deleteOldRecordingsJob();
  }, { timezone: "Asia/Kolkata" });
};