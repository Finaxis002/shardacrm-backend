// seed.js
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config();

const seedDatabase = async () => {
  try {
    // Database se connect ho
    await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://localhost:27017/sharda_crm",
    );
    console.log("✅ Connected to MongoDB");

    const db = mongoose.connection.db;

    // Hash password
    const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);

    // Create organization if not exists
    let org = await db.collection("organizations").findOne({
      slug: "sharda-associates",
    });

    if (!org) {
      const orgResult = await db.collection("organizations").insertOne({
        name: "Sharda Associates",
        slug: "sharda-associates",
        createdAt: new Date(),
      });
      org = { _id: orgResult.insertedId };
      console.log("✅ Organization created");
    } else {
      console.log("ℹ️ Organization already exists");
    }

    // Insert admins if not exists
    const admins = [
      {
        name: "Anugrah Sharda",
        email: "anugrah@sharda.in",
        password: hashedPassword,
        role: "admin",
        organization: org._id,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: "Anunay Sharda",
        email: "anunay@sharda.in",
        password: hashedPassword,
        role: "admin",
        organization: org._id,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    for (const admin of admins) {
      const exists = await db
        .collection("users")
        .findOne({ email: admin.email });
      if (!exists) {
        await db.collection("users").insertOne(admin);
        console.log(`✅ Admin created: ${admin.name}`);
      } else {
        console.log(`ℹ️ Admin already exists: ${admin.name}`);
      }
    }

    // Check if settings exist
    const settings = await db.collection("settings").findOne({
      organization: org._id,
    });

    if (!settings) {
      await db.collection("settings").insertOne({
        organization: org._id,
        companyName: "Sharda Associates",
        currency: "₹",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log("✅ Settings created");
    }

    console.log("✅ Seeding completed successfully!");
    await mongoose.disconnect();
  } catch (error) {
    console.error("❌ Error:", error);
  }
};

seedDatabase();
