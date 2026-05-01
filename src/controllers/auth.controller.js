import jwt from "jsonwebtoken";
import { config } from "../config/env.js";
import User from "../models/User.model.js";
import Organization from "../models/Organization.model.js";
import Settings from "../models/Settings.model.js";
import ApiResponse from "../utils/apiResponse.js";
import ApiError from "../utils/apiError.js";
import asyncHandler from "../utils/asyncHandler.js";

const generateTokens = async (userId) => {
  const user = await User.findById(userId);

  const accessToken = jwt.sign(
    {
      _id: user._id,
      email: user.email,
      role: user.role,
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpire },
  );

  const refreshToken = jwt.sign(
    {
      _id: user._id,
    },
    config.jwtSecret,
    { expiresIn: "30d" },
  );

  user.refreshToken = refreshToken;
  await user.save();

  return { accessToken, refreshToken };
};

export const register = asyncHandler(async (req, res) => {
  const { name, email, password, confirmPassword, companyName } = req.body;

  if (!name || !email || !password || !companyName) {
    throw new ApiError(400, "All fields are required");
  }

  if (password !== confirmPassword) {
    throw new ApiError(400, "Passwords do not match");
  }

  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    throw new ApiError(400, "Email already registered");
  }

  // Create organization
  const org = await Organization.create({
    name: companyName,
    slug: companyName.toLowerCase().replace(/\s+/g, "-"),
    owner: null, // Will be set after user creation
  });

  // Create user
  const user = await User.create({
    name,
    email: email.toLowerCase(),
    password,
    role: "admin",
    organization: org._id,
  });

  // Update organization with owner
  org.owner = user._id;
  org.members = [user._id];
  await org.save();

  // Create settings
  await Settings.create({
    organization: org._id,
    companyName,
    distributionMethod: "round_robin",
    distributionPool: [],
    rrIndex: 0,
    pipelineStages: [
      { name: "New", color: "#6b7280", order: 0 },
      { name: "Interested", color: "#b86e00", order: 1 },
      { name: "Details Shared", color: "#6c35de", order: 2 },
      { name: "Success", color: "#2a7d4f", order: 3 },
      { name: "Closed", color: "#1a1a18", order: 4 },
    ],
    permissions: {
      "View all leads": {
        admin: true,
        manager: true,
        tl: false,
        exec: false,
        viewer: false,
      },
      "Add leads": {
        admin: true,
        manager: true,
        tl: true,
        exec: true,
        viewer: false,
      },
      "Edit any lead": {
        admin: true,
        manager: true,
        tl: false,
        exec: false,
        viewer: false,
      },
      "Delete leads": {
        admin: true,
        manager: false,
        tl: false,
        exec: false,
        viewer: false,
      },
      "Assign leads": {
        admin: true,
        manager: true,
        tl: true,
        exec: false,
        viewer: false,
      },
      "Change lead owner": {
        admin: true,
        manager: true,
        tl: false,
        exec: false,
        viewer: false,
      },
      "Record payments": {
        admin: true,
        manager: true,
        tl: false,
        exec: false,
        viewer: false,
      },
      "Import from sheets": {
        admin: true,
        manager: true,
        tl: false,
        exec: false,
        viewer: false,
      },
      "View team": {
        admin: true,
        manager: true,
        tl: true,
        exec: false,
        viewer: false,
      },
      "Admin panel": {
        admin: true,
        manager: false,
        tl: false,
        exec: false,
        viewer: false,
      },
    },
    rbacExecOnly: true,
    rbacCoEditorsCanEdit: true,
    leadColumns: ["name", "phone", "source", "value", "status", "assign"],
    customColumns: [],
    gcalConnected: false,
    gcalUser: "",
    gmailEnabled: false,
    gateways: {},
    defaultGateway: "",
    paymentLinkExpiry: 48,
    aiProvider: "",
    aiKey: "",
    aiModel: "",
    aiEndpoint: "",
    aiPrompt: "",
    aiAutoAnalyse: false,
    aiScanNotes: true,
    aiIntent: false,
    currency: "₹",
    timezone: "Asia/Kolkata",
  });

  const { accessToken, refreshToken } = await generateTokens(user._id);

  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  };

  return res
    .status(201)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
      new ApiResponse(
        201,
        { user: user.toJSON(), accessToken },
        "User registered successfully",
      ),
    );
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new ApiError(400, "Email and password are required");
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select(
    "+password",
  );

  if (!user) {
    throw new ApiError(401, "Invalid email or password");
  }

  const isPasswordValid = await user.comparePassword(password);

  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid email or password");
  }

  const { accessToken, refreshToken } = await generateTokens(user._id);

  user.lastLogin = new Date();
  await user.save();

  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  };

  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
      new ApiResponse(
        200,
        { user: user.toJSON(), accessToken },
        "User logged in successfully",
      ),
    );
});

export const refreshToken = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { accessToken, refreshToken } = await generateTokens(userId);

  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  };

  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
      new ApiResponse(
        200,
        { accessToken },
        "Access token refreshed successfully",
      ),
    );
});

export const logout = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, {
    $unset: {
      refreshToken: 1,
    },
  });

  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  };

  return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new ApiResponse(200, {}, "User logged out successfully"));
});

export const getCurrentUser = asyncHandler(async (req, res) => {
  return res
    .status(200)
    .json(new ApiResponse(200, req.user.toJSON(), "Current user fetched"));
});

// Admin initialization endpoint (one-time setup for production)
export const initializeAdmin = asyncHandler(async (req, res) => {
  // Check if any admin already exists
  const existingAdmin = await User.findOne({ role: "admin" });

  if (existingAdmin) {
    throw new ApiError(
      400,
      "Admin already exists. Initialization cannot be performed.",
    );
  }

  // Hardcoded admin credentials
  const admins = [
    {
      name: "Anugrah Sharda",
      email: "anugrah@sharda.in",
      password: "admin@123",
    },
    {
      name: "Anunay Sharda",
      email: "anunay@sharda.in",
      password: "admin@123",
    },
  ];

  const companyName = "Sharda Associates";

  // Create organization
  const org = await Organization.create({
    name: companyName,
    slug: "sharda-associates",
    owner: null,
    members: [],
  });

  // Create all admin users
  const createdAdmins = [];
  for (const admin of admins) {
    const user = await User.create({
      name: admin.name,
      email: admin.email.toLowerCase(),
      password: admin.password,
      role: "admin",
      organization: org._id,
      isActive: true,
      phone: "+91-9999999999",
    });
    createdAdmins.push(user);
    org.members.push(user._id);
  }

  // Update organization with owner and members
  org.owner = createdAdmins[0]._id;
  await org.save();

  // Create default organization settings
  await Settings.create({
    organization: org._id,
    companyName,
    distributionMethod: "round_robin",
    distributionPool: [],
    rrIndex: 0,
    pipelineStages: [
      { name: "New", color: "#6b7280", order: 0 },
      { name: "Interested", color: "#b86e00", order: 1 },
      { name: "Details Shared", color: "#6c35de", order: 2 },
      { name: "Success", color: "#2a7d4f", order: 3 },
      { name: "Closed", color: "#1a1a18", order: 4 },
    ],
    permissions: {
      "View all leads": {
        admin: true,
        manager: true,
        tl: false,
        exec: false,
        viewer: false,
      },
      "Add leads": {
        admin: true,
        manager: true,
        tl: true,
        exec: true,
        viewer: false,
      },
      "Edit any lead": {
        admin: true,
        manager: true,
        tl: false,
        exec: false,
        viewer: false,
      },
      "Delete leads": {
        admin: true,
        manager: false,
        tl: false,
        exec: false,
        viewer: false,
      },
      "Assign leads": {
        admin: true,
        manager: true,
        tl: true,
        exec: false,
        viewer: false,
      },
      "Change lead owner": {
        admin: true,
        manager: true,
        tl: false,
        exec: false,
        viewer: false,
      },
      "Record payments": {
        admin: true,
        manager: true,
        tl: false,
        exec: false,
        viewer: false,
      },
      "Import from sheets": {
        admin: true,
        manager: true,
        tl: false,
        exec: false,
        viewer: false,
      },
      "View team": {
        admin: true,
        manager: true,
        tl: true,
        exec: false,
        viewer: false,
      },
      "Admin panel": {
        admin: true,
        manager: false,
        tl: false,
        exec: false,
        viewer: false,
      },
    },
    rbacExecOnly: true,
    rbacCoEditorsCanEdit: true,
    leadColumns: ["name", "phone", "source", "value", "status", "assign"],
    customColumns: [],
    gcalConnected: false,
    gcalUser: "",
    gmailEnabled: false,
    gateways: {},
    defaultGateway: "",
    paymentLinkExpiry: 48,
    aiProvider: "",
    aiKey: "",
    aiModel: "",
    aiEndpoint: "",
    aiPrompt: "",
    aiAutoAnalyse: false,
    aiScanNotes: true,
    aiIntent: false,
    currency: "₹",
    timezone: "Asia/Kolkata",
  });

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        admins: createdAdmins.map((user) => user.toJSON()),
        organization: {
          id: org._id,
          name: org.name,
        },
      },
      "Admin initialized successfully. Login with credentials: anugrah@sharda.in / admin@123",
    ),
  );
});
