import User from "../models/User.model.js";
import Lead from "../models/Lead.model.js";
import Organization from "../models/Organization.model.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import { formatPaginatedResponse, parsePagination } from "../utils/paginate.js";
import { canUser } from "../utils/permissions.js";
import logger from "../utils/logger.js";

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

  const leadCountMap = {};
  if (users.length) {
    const leadCounts = await Lead.aggregate([
      {
        $match: {
          organization,
          assignedTo: { $in: users.map((user) => user._id) },
        },
      },
      {
        $group: {
          _id: "$assignedTo",
          count: { $sum: 1 },
        },
      },
    ]);

    leadCounts.forEach((item) => {
      leadCountMap[item._id.toString()] = item.count;
    });
  }

  const usersWithLeadCount = users.map((user) => ({
    ...user,
    leadCount: leadCountMap[user._id.toString()] || 0,
  }));

  logger.info(`Fetched ${usersWithLeadCount.length} team members`);

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        formatPaginatedResponse(usersWithLeadCount, total, pageNum, pageLimit),
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

  if (!password) {
    throw new ApiError(400, "Password is required");
  }

  // Check if user already exists
  const existingUser = await User.findOne({
    email: email.toLowerCase(),
    organization,
  });
  if (existingUser) {
    throw new ApiError(
      400,
      "User with this email already exists in organization",
    );
  }

  const user = new User({
    name,
    email: email.toLowerCase(),
    password,
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
 * @access Private (Admin, Manage Users permission, or Self)
 */
export const updateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, phone, role, password } = req.body;
  const organization = req.user.organization;
  const currentUserId = req.user._id;

  const userToUpdate = await User.findOne({ _id: id, organization });
  if (!userToUpdate) {
    throw new ApiError(404, "User not found");
  }

  const isSelf = currentUserId.equals(id);
  const isAdmin = req.user.role === "admin";
  const canManageUsers = await canUser(req.user, organization, "manage_users");

  // Authorization: Check if user has right to perform any update
  if (!isAdmin && !isSelf && !canManageUsers) {
    throw new ApiError(403, "Not authorized to update this user");
  }

  // Role Change Logic: Only Admin or users with manage_users can change roles
  if (role && role !== userToUpdate.role) {
    if (!isAdmin && !canManageUsers) {
      throw new ApiError(403, "Not authorized to change user roles");
    }
    // Prevent users from changing their own role (even if they have manage_users)
    if (isSelf && !isAdmin) {
      throw new ApiError(403, "You cannot change your own role");
    }
    userToUpdate.role = role;
  }

  // Update profile fields
  if (name) userToUpdate.name = name;
  if (phone) userToUpdate.phone = phone;
  if (password) userToUpdate.password = password;

  await userToUpdate.save();

  const userResponse = {
    _id: userToUpdate._id,
    name: userToUpdate.name,
    email: userToUpdate.email,
    phone: userToUpdate.phone,
    role: userToUpdate.role,
    organization: userToUpdate.organization,
  };

  logger.info(`User updated: ${id} by ${currentUserId}`);

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
  const currentUserId = req.user._id;

  // Check if current user is Admin or has 'manage_users' permission
  const isAdmin = req.user.role === "admin";
  const canManageUsers = await canUser(req.user, organization, "manage_users");

  if (!isAdmin && !canManageUsers) {
    throw new ApiError(403, "Not authorized to change user roles");
  }

  // Prevent users from changing their own role to avoid self-elevation
  if (currentUserId.equals(id) && !isAdmin) {
    throw new ApiError(403, "You cannot change your own role");
  }

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

  logger.info(`User role updated: ${id} to ${role} by ${currentUserId}`);

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
  const currentUserId = req.user._id;

  // Check for Admin role or manage_users permission
  const isAdmin = req.user.role === "admin";
  const canManageUsers = await canUser(req.user, organization, "manage_users");

  if (!isAdmin && !canManageUsers) {
    throw new ApiError(403, "Not authorized to update user permissions");
  }

  // Prevent non-admin users from updating their own permissions
  if (currentUserId.equals(id) && !isAdmin) {
    throw new ApiError(403, "You cannot update your own permissions");
  }

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

  logger.info(`User permissions updated: ${id} by ${currentUserId}`);

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
  const currentUserId = req.user._id;

  // Check for Admin role or manage_users permission
  const isAdmin = req.user.role === "admin";
  const canManageUsers = await canUser(req.user, organization, "manage_users");

  if (!isAdmin && !canManageUsers) {
    throw new ApiError(403, "Not authorized to delete users");
  }

  // Prevent users from deleting themselves
  if (currentUserId.equals(id)) {
    throw new ApiError(400, "You cannot delete your own account from here");
  }

  const user = await User.findOne({ _id: id, organization });
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  // Prevent deleting organization owner
  const org = await Organization.findById(organization);
  if (org?.owner && org.owner.equals(id)) {
    throw new ApiError(400, "Cannot delete organization owner");
  }

  await User.findByIdAndDelete(id);

  logger.info(`User deleted: ${id} by ${currentUserId}`);

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
