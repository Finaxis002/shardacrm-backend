import User from "../models/User.model.js";
import Organization from "../models/Organization.model.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { formatPaginatedResponse, parsePagination } from "../utils/paginate.js";
import logger from "../utils/logger.js";
import bcrypt from "bcryptjs";

/**
 * Get all team members
 * @route GET /api/v1/users
 * @access Private
 */
export const getTeamMembers = asyncHandler(async (req, res) => {
  const { page, limit, role, search } = req.query;
  const organization = req.user.organization;

  const filter = { organization };
  if (role) filter.role = role;

  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }

  const {
    skip,
    limit: pageLimit,
    page: pageNum,
  } = parsePagination({
    page,
    limit,
  });

  const users = await User.find(filter)
    .select("-password")
    .skip(skip)
    .limit(pageLimit)
    .lean();

  const total = await User.countDocuments(filter);

  logger.info(`Fetched ${users.length} team members`);

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        formatPaginatedResponse(users, total, pageNum, pageLimit),
        "Team members fetched successfully",
      ),
    );
});

/**
 * Get single user
 * @route GET /api/v1/users/:id
 * @access Private
 */
export const getUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const organization = req.user.organization;

  const user = await User.findOne({ _id: id, organization })
    .select("-password")
    .lean();

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  res.status(200).json(new ApiResponse(200, user, "User fetched successfully"));
});

/**
 * Create new team member
 * @route POST /api/v1/users
 * @access Private (Admin only)
 */
export const createTeamMember = asyncHandler(async (req, res) => {
  const { name, email, password, phone, role } = req.body;
  const organization = req.user.organization;

  // Check if user already exists
  const existingUser = await User.findOne({ email, organization });
  if (existingUser) {
    throw new ApiError(
      400,
      "User with this email already exists in organization",
    );
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  const user = new User({
    name,
    email,
    password: hashedPassword,
    phone,
    role: role || "viewer",
    organization,
  });

  await user.save();

  // Return user without password
  const userResponse = {
    _id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    organization: user.organization,
  };

  logger.info(
    `Team member created: ${user._id} in organization ${organization}`,
  );

  res
    .status(201)
    .json(
      new ApiResponse(201, userResponse, "Team member created successfully"),
    );
});

/**
 * Update user
 * @route PUT /api/v1/users/:id
 * @access Private (Admin or self)
 */
export const updateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, phone, role } = req.body;
  const organization = req.user.organization;
  const userId = req.user._id;

  const user = await User.findOne({ _id: id, organization });
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  // Only admin or the user themselves can update
  if (req.user.role !== "admin" && !userId.equals(id)) {
    throw new ApiError(403, "Not authorized to update this user");
  }

  // Admin can change role, but user cannot change their own role
  if (role && req.user.role !== "admin") {
    throw new ApiError(403, "Only admin can change user roles");
  }

  if (name) user.name = name;
  if (phone) user.phone = phone;
  if (role && req.user.role === "admin") user.role = role;

  await user.save();

  const userResponse = {
    _id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    organization: user.organization,
  };

  logger.info(`User updated: ${id}`);

  res
    .status(200)
    .json(new ApiResponse(200, userResponse, "User updated successfully"));
});

/**
 * Update user role
 * @route PATCH /api/v1/users/:id/role
 * @access Private (Admin only)
 */
export const updateUserRole = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  const organization = req.user.organization;

  const user = await User.findOne({ _id: id, organization });
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  user.role = role;
  await user.save();

  const userResponse = {
    _id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    organization: user.organization,
  };

  logger.info(`User role updated: ${id} to ${role}`);

  res
    .status(200)
    .json(new ApiResponse(200, userResponse, "User role updated successfully"));
});

/**
 * Update user permissions
 * @route PATCH /api/v1/users/:id/permissions
 * @access Private (Admin only)
 */
export const updateUserPermissions = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { permissions } = req.body;
  const organization = req.user.organization;

  const user = await User.findOne({ _id: id, organization });
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  user.permissions = permissions;
  await user.save();

  const userResponse = {
    _id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    permissions: user.permissions,
    organization: user.organization,
  };

  logger.info(`User permissions updated: ${id}`);

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        userResponse,
        "User permissions updated successfully",
      ),
    );
});

/**
 * Delete user
 * @route DELETE /api/v1/users/:id
 * @access Private (Admin only)
 */
export const deleteUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const organization = req.user.organization;

  const user = await User.findOne({ _id: id, organization });
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  // Prevent deleting organization owner
  const org = await Organization.findById(organization);
  if (org.owner.equals(id)) {
    throw new ApiError(400, "Cannot delete organization owner");
  }

  await User.findByIdAndDelete(id);

  logger.info(`User deleted: ${id}`);

  res.status(200).json(new ApiResponse(200, null, "User deleted successfully"));
});

/**
 * Get organization members count by role
 * @route GET /api/v1/users/stats/summary
 * @access Private
 */
export const getTeamStats = asyncHandler(async (req, res) => {
  const organization = req.user.organization;

  const stats = await User.aggregate([
    { $match: { organization } },
    {
      $group: {
        _id: "$role",
        count: { $sum: 1 },
      },
    },
  ]);

  const totalMembers = await User.countDocuments({ organization });

  res.status(200).json(
    new ApiResponse(
      200,
      {
        total: totalMembers,
        byRole: stats,
      },
      "Team statistics fetched successfully",
    ),
  );
});

/**
 * Get user's personal info
 * @route GET /api/v1/users/profile/me
 * @access Private
 */
export const getMyProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("-password").lean();

  res
    .status(200)
    .json(new ApiResponse(200, user, "Profile fetched successfully"));
});

/**
 * Update my profile
 * @route PUT /api/v1/users/profile/me
 * @access Private
 */
export const updateMyProfile = asyncHandler(async (req, res) => {
  const { name, phone, avatar } = req.body;
  const userId = req.user._id;

  const user = await User.findByIdAndUpdate(
    userId,
    { name, phone, avatar },
    { new: true },
  ).select("-password");

  logger.info(`User profile updated: ${userId}`);

  res
    .status(200)
    .json(new ApiResponse(200, user, "Profile updated successfully"));
});
