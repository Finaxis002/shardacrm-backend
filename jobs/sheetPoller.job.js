/**
 * sheetPoller.job.js
 * ─────────────────
 * Har 1 minute mein active Google Sheet syncs check karta hai
 * aur naye rows ko leads mein import karta hai.
 *
 * Usage (app.js mein):
 *   import { startSheetPoller } from "../jobs/sheetPoller.job.js";
 *   startSheetPoller();
 */

import GoogleSheetSync from "../src/models/GoogleSheetSync.model.js";
import { syncNewRows }  from "../src/controllers/googleSheets.controller.js";
import logger           from "../src/utils/logger.js";

const POLL_INTERVAL_MS = 60 * 1000; // 1 minute

let pollerTimer = null;
let isRunning   = false;

/**
 * Main poll function — runs once per interval
 */
const pollAllActiveSheets = async () => {
  if (isRunning) {
    logger.info("[SheetPoller] Previous run still in progress, skipping this tick");
    return;
  }

  isRunning = true;

  try {
    // Fetch all active syncs whose token has not expired
    const activeSyncs = await GoogleSheetSync.find({
  isActive: true,
});

    if (!activeSyncs.length) {
      logger.info("[SheetPoller] No active syncs found");
      return;
    }

    logger.info(`[SheetPoller] Checking ${activeSyncs.length} active sheet(s)...`);

    // Run all syncs in parallel (limit concurrency if needed)
    await Promise.allSettled(
      activeSyncs.map(sync => syncNewRows(sync))
    );

    logger.info("[SheetPoller] Tick complete");
  } catch (err) {
    logger.error(`[SheetPoller] Fatal error: ${err.message}`);
  } finally {
    isRunning = false;
  }
};

/**
 * Start the poller
 * Call once from app.js after DB connection is established
 */
export const startSheetPoller = () => {
  if (pollerTimer) {
    logger.warn("[SheetPoller] Already running, ignoring startSheetPoller() call");
    return;
  }

  logger.info(`[SheetPoller] Started — polling every ${POLL_INTERVAL_MS / 1000}s`);

  // Run immediately on start, then every interval
  pollAllActiveSheets();
  pollerTimer = setInterval(pollAllActiveSheets, POLL_INTERVAL_MS);
};

/**
 * Stop the poller (useful for graceful shutdown)
 */
export const stopSheetPoller = () => {
  if (pollerTimer) {
    clearInterval(pollerTimer);
    pollerTimer = null;
    logger.info("[SheetPoller] Stopped");
  }
};