import dotenv from "dotenv";

dotenv.config();

export const config = {
  // Server
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || "development",
  apiVersion: process.env.API_VERSION || "v1",

  // Database
  mongoUri:
    process.env.MONGODB_URI ||
    "mongodb+srv://finaxisai:EjMibOyOOojhb2TA@cluster0.jwsdd0d.mongodb.net/shardacrm?appName=Cluster0",

  // JWT
  jwtSecret: process.env.JWT_SECRET || "your-secret-key",
  jwtExpire: process.env.JWT_EXPIRE || "7d",

  // CORS
  corsOrigin: process.env.CORS_ORIGIN?.split(",") || ["http://localhost:3000"],

  // Cloudinary
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },

  // Email
  smtp: {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM,
  },

  // Google
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  },

  // Payment Gateways
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  },
  payu: {
    merchantKey: process.env.PAYU_MERCHANT_KEY,
    merchantSalt: process.env.PAYU_MERCHANT_SALT,
  },

  // Redis
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",

  // AI
  ai: {
    provider: process.env.AI_PROVIDER || "openai",
    openaiKey: process.env.OPENAI_API_KEY,
    anthropicKey: process.env.ANTHROPIC_API_KEY,
    geminiKey: process.env.GEMINI_API_KEY,
  },

  GOOGLE_SERVICE_ACCOUNT_PATH: process.env.GOOGLE_SERVICE_ACCOUNT_PATH,

  // Logging
  logLevel: process.env.LOG_LEVEL || "debug",
};
