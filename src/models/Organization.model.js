import mongoose from "mongoose";

const organizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
    },
    description: String,
    logo: String, // Cloudinary URL
    website: String,
    email: String,
    phone: String,
    address: String,
    city: String,
    state: String,
    country: String,
    postalCode: String,

    // Admin/Owner
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Members
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // Subscription
    plan: {
      type: String,
      enum: ["free", "starter", "professional", "enterprise"],
      default: "free",
    },
    planExpiryDate: Date,
    isActive: {
      type: Boolean,
      default: true,
    },

    // Usage stats
    leadsCount: {
      type: Number,
      default: 0,
    },
    usersCount: {
      type: Number,
      default: 1,
    },
  },
  { timestamps: true },
);

const Organization = mongoose.model("Organization", organizationSchema);
export default Organization;
