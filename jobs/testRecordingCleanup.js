import mongoose from "mongoose";
import connectDB from "../src/config/db.js";
import { deleteOldRecordingsJob } from "./deleteOldRecordings.job.js";

const run = async () => {
  try {
    await connectDB();
    console.log("✅ Connected to DB. Running recording cleanup job...");
    await deleteOldRecordingsJob();
    console.log("✅ Done. Check the lead in MongoDB now.");
  } catch (err) {
    console.error("❌ Error running cleanup job:", err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

run();