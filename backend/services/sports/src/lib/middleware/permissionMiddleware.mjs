// middleware/permissionMiddleware.js — mssports core, moved unchanged

var requireOwner = (req, res, next) => {
  if (req.user?.actor?.type !== "OWNER") {
    return res.status(403).json({
      success: false,
      message: "Access denied. Owner only."
    });
  }
  return next();
};
var requireBackoffice = (req, res, next) => {
  const actorType = req.user?.actor?.type;
  if (actorType !== "OWNER" && actorType !== "STAFF" && actorType !== "EXECUTIVE") {
    return res.status(403).json({
      success: false,
      message: "Access denied. Back-office accounts only."
    });
  }
  return next();
};

export { requireOwner, requireBackoffice };
