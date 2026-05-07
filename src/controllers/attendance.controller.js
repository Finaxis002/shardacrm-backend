import Attendance from "../models/Attendance.model.js";
import User from "../models/User.model.js";

const dateStr = (d = new Date()) =>
  d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const timeStr = (d = new Date()) =>
  d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });

export const markAttendance = async (req, res) => {
  try {
    const userId = req.user._id;
    const today = dateStr();
    const existing = await Attendance.findOne({ userId, date: today });
    if (existing) {
      return res.status(409).json({ message: "Attendance already marked for today" });
    }
    const record = await Attendance.create({
      userId,
      date: today,
      checkIn: timeStr(),
      status: "present",
    });
    res.status(201).json({ message: "Attendance marked", data: record });
  } catch (err) {
    console.error("markAttendance:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const myAttendance = async (req, res) => {
  try {
    const userId = req.user._id;
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    const records = await Attendance.find({
      userId,
      date: { $regex: `^${prefix}` },
    }).lean();
    const byDate = {};
    records.forEach((r) => { byDate[r.date] = r; });
    res.json({ month, year, records: byDate });
  } catch (err) {
    console.error("myAttendance:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const adminMonthly = async (req, res) => {
  try {
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    const totalUsers = await User.countDocuments({ isActive: true });
    const records = await Attendance.find({
      date: { $regex: `^${prefix}` },
      status: "present",
    }).lean();
    const presentByDate = {};
    records.forEach((r) => {
      presentByDate[r.date] = (presentByDate[r.date] || 0) + 1;
    });
    const summary = {};
    Object.entries(presentByDate).forEach(([date, present]) => {
      summary[date] = { present, absent: totalUsers - present };
    });
    res.json({ month, year, totalUsers, summary });
  } catch (err) {
    console.error("adminMonthly:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const adminDayDetail = async (req, res) => {
  try {
    const date = req.query.date || dateStr();
    const presentRecords = await Attendance.find({ date, status: "present" })
      .populate("userId", "name email phone role")
      .lean();
    const validPresent = presentRecords.filter((r) => r.userId);
    const presentIds = validPresent.map((r) => r.userId._id.toString());
    const absentUsers = await User.find({
      isActive: true,
      _id: { $nin: presentIds },
    }).select("name email phone role").lean();
    res.json({
      date,
      present: validPresent.map((r) => ({
        _id: r.userId._id,
        name: r.userId.name,
        email: r.userId.email,
        phone: r.userId.phone,
        role: r.userId.role,
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        status: r.status,
      })),
      absent: absentUsers,
      presentCount: validPresent.length,
      absentCount: absentUsers.length,
    });
  } catch (err) {
    console.error("adminDayDetail:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const adminUserMonthly = async (req, res) => {
  try {
    const { userId } = req.params;
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    const user = await User.findById(userId).select("name email phone role").lean();
    if (!user) return res.status(404).json({ message: "User not found" });
    const records = await Attendance.find({
      userId,
      date: { $regex: `^${prefix}` },
    }).lean();
    const byDate = {};
    records.forEach((r) => { byDate[r.date] = r; });
    res.json({ month, year, user, records: byDate });
  } catch (err) {
    console.error("adminUserMonthly:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getAllUsers = async (req, res) => {
  try {
    const { search } = req.query;
    const filter = { isActive: true };
    if (search) {
      filter.$or = [
        { name:  { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }
    const users = await User.find(filter).select("name email phone role").lean();
    res.json(users);
  } catch (err) {
    console.error("getAllUsers:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const adminManualMark = async (req, res) => {
  try {
    const { userId, date, status, checkIn, checkOut } = req.body;
    if (!userId || !date) {
      return res.status(400).json({ message: "userId and date are required" });
    }
    const record = await Attendance.findOneAndUpdate(
      { userId, date },
      { status: status || "present", checkIn, checkOut, markedAt: new Date() },
      { upsert: true, new: true }
    );
    res.json({ message: "Attendance updated", data: record });
  } catch (err) {
    console.error("adminManualMark:", err);
    res.status(500).json({ message: "Server error" });
  }
};