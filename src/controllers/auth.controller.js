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
