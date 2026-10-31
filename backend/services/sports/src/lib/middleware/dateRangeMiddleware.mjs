// middleware/dateRangeMiddleware.js — mssports core, moved unchanged

var MS_PER_DAY = 1e3 * 60 * 60 * 24;
var maxDateRange = (maxDays) => (req, res, next) => {
  try {
    const { fromDate, toDate } = req.body || {};
    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (!fromDate || !toDate || isNaN(from.getTime()) || isNaN(to.getTime())) {
      return res.status(400).json({ success: false, message: "fromDate and toDate are required (YYYY-MM-DD)." });
    }
    const rangeDays = (to - from) / MS_PER_DAY;
    if (rangeDays < 0) {
      return res.status(400).json({ success: false, message: "fromDate cannot be after toDate." });
    }
    if (rangeDays > maxDays) {
      return res.status(400).json({ success: false, message: `Date range cannot be more than ${maxDays} days.` });
    }
    next();
  } catch (error) {
    console.error("\u274C [maxDateRange] error:", error);
    return res.status(500).json({ success: false, message: "Server error while validating date range." });
  }
};

export { maxDateRange };
