// seed.js - Admin Seeding Script
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config();

const seedDatabase = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://localhost:27017/sharda_crm",
    );
    console.log("✅ Connected to MongoDB");

    const db = mongoose.connection.db;

    // Admin password from .env (DO NOT CHANGE - use only for testing)
    const adminPassword = process.env.ADMIN_PASSWORD || "admin@123";
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    console.log(`\n📝 ADMIN CREDENTIALS:`);
    console.log(`   Email: anugrah@sharda.in`);
    console.log(`   Password: ${adminPassword}`);
    console.log(`\n⚠️  Change these immediately after login!\n`);

    // Create organization if not exists
    let org = await db.collection("organizations").findOne({
      slug: "sharda-associates",
    });

    if (!org) {
      const orgResult = await db.collection("organizations").insertOne({
        name: "Sharda Associates",
        slug: "sharda-associates",
        owner: null,
        members: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      org = { _id: orgResult.insertedId };
      console.log("✅ Organization created: Sharda Associates");
    } else {
      console.log("ℹ️  Organization already exists");
    }

    // Admin users to seed
    const admins = [
      {
        name: "Anugrah Sharda",
        email: "anugrah@sharda.in",
        password: hashedPassword,
        role: "admin",
        organization: org._id,
        isActive: true,
        phone: "+91-9999999999",
        lastLogin: null,
        refreshToken: null,
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
        phone: "+91-9999999998",
        lastLogin: null,
        refreshToken: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    // Seed admin users
    for (const admin of admins) {
      const exists = await db.collection("users").findOne({
        email: admin.email,
      });

      if (!exists) {
        const result = await db.collection("users").insertOne(admin);
        org.members = org.members || [];
        if (!org.members.includes(result.insertedId)) {
          org.members.push(result.insertedId);
        }
        console.log(`✅ Admin user created: ${admin.name} (${admin.email})`);
      } else {
        console.log(`ℹ️  Admin already exists: ${admin.name}`);
      }
    }

    // Update organization with members
    await db
      .collection("organizations")
      .updateOne({ _id: org._id }, { $set: { members: org.members } });

    // Create organization settings if not exist
    const settings = await db.collection("settings").findOne({
      organization: org._id,
    });

    if (!settings) {
      await db.collection("settings").insertOne({
        organization: org._id,
        companyName: "Sharda Associates",
        currency: "₹",
        timezone: "Asia/Kolkata",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log("✅ Organization settings created");
    }

    console.log("\n✅ Database seeding completed successfully!");
    console.log("🚀 Ready for login. Use credentials above to sign in.\n");

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("❌ Seeding Error:", error.message);
    await mongoose.disconnect();
    process.exit(1);
  }
};

seedDatabase();
