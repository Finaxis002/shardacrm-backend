import mongoose from "mongoose";
import { config } from "./env.js";
import logger from "../utils/logger.js";

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(config.mongoUri);

    // Success message with Host
    logger.info(`✅ Database Connected Successfully`);

    return conn;
  } catch (error) {
    logger.error(`❌ Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
