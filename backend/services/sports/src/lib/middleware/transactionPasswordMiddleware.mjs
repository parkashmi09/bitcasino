// middleware/transactionPasswordMiddleware.js — mssports core, moved unchanged
import { verifyTxnPasswordWithAttempts } from "../services/transactionPasswordService.mjs";

var verifyTransactionPassword = async (req, res, next) => {
  try {
    const { transactionPassword } = req.body;
    const result = await verifyTxnPasswordWithAttempts(req.user, transactionPassword);
    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
        attemptsLeft: result.attemptsLeft
      });
    }
    next();
  } catch (error) {
    console.error("\u274C Transaction password verification error:", error);
    res.status(500).json({ success: false, message: "Internal server error during verification" });
  }
};
var verifyTransactionPasswordAs = (notValidMessage) => async (req, res, next) => {
  try {
    const { transactionPassword } = req.body;
    const result = await verifyTxnPasswordWithAttempts(req.user, transactionPassword);
    if (!result.ok) {
      const wrongPassword = result.status === 400 && !!transactionPassword;
      return res.status(result.status).json({
        success: false,
        message: wrongPassword ? notValidMessage : result.message,
        attemptsLeft: result.attemptsLeft
      });
    }
    next();
  } catch (error) {
    console.error("\u274C Transaction password verification error:", error);
    res.status(500).json({ success: false, message: "Internal server error during verification" });
  }
};
var transactionPasswordMiddleware_default = verifyTransactionPassword;

export { verifyTransactionPasswordAs, transactionPasswordMiddleware_default };
