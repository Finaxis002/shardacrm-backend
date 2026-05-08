import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, "Invalid email"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
      select: false,
    },
    phone: {
      type: String,
      sparse: true,
    },
    avatar: {
      type: String, // Cloudinary URL
      default: null,
    },
    color: {
      type: String,
      default: "#2f6df5",
    },
    role: {
      type: String,
      enum: ["admin", "manager", "tl", "exec", "viewer"],
      default: "exec",
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
    },
    permissions: [
      {
        type: String,
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
      default: null,
    },
    googleId: {
      type: String,
      sparse: true,
    },
    refreshToken: {
      type: String,
      select: false,
    },

    // ── Google Calendar (per-user connection) ─────────────────────────────
    gcalConnected: {
      type: Boolean,
      default: false,
    },
    gcalUser: {
      type: String,   // connected Gmail address
      default: "",
    },
    gcalTokens: {
      access_token:  { type: String, default: "", select: false },
      refresh_token: { type: String, default: "", select: false },
      expiry_date:   { type: Number, default: 0,  select: false },
      token_type:    { type: String, default: "" },
      scope:         { type: String, default: "" },
    },
    // ─────────────────────────────────────────────────────────────────────
  },
  { timestamps: true },
);

// Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare passwords
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Remove sensitive fields in JSON
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshToken;
  // gcalTokens bhi hide karo — frontend ko sirf gcalConnected & gcalUser chahiye
  delete obj.gcalTokens;
  return obj;
};

const User = mongoose.model("User", userSchema);
export default User;