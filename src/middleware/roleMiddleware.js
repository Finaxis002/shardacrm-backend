export const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === "admin") return next();
  return res.status(403).json({ message: "Admin access required" });
};

export const managerOrAdmin = (req, res, next) => {
  if (req.user && ["admin", "manager"].includes(req.user.role)) return next();
  return res.status(403).json({ message: "Manager or Admin access required" });
};