// constants/messages.js — mssports core, moved unchanged

var MESSAGES = {
  AUTH: {
    CREDENTIALS_REQUIRED: "Email/Username and password are required",
    LOGIN_SUCCESS: "Login successful",
    MISSING_USERID_OR_OTP: "Missing userId or OTP",
    TWO_FA_VERIFIED: "2FA Verified",
    MISSING_USERID: "Missing userId",
    // Same reference toast as OTP_SENT — resend announces the code the
    // same way the initial generation does.
    OTP_RESENT: "Sucessfully Code Generate.",
    TOKEN_NOT_PROVIDED: "Token not provided",
    LOGOUT_SUCCESS: "Logged out successfully.",
    PASSWORDS_REQUIRED: "Current and new passwords are required",
    PASSWORD_CHANGED: "Password changed successfully",
    USER_ID_MISSING: "user_id missing (send it in the payload or use a valid token)",
    USER_NOT_FOUND: "User not exist",
    ACCOUNT_INACTIVE: "Account is inactive. Please contact support.",
    // This account or a staff above it is inactive — player + staff login
    // (helper/accountLockChain.js). Also the forceLogout toast on a lock.
    USER_LOCKED_CONTACT_UPLINE: "User is locked. Please contact upper level.",
    PASSWORD_WRONG: "Password is wrong",
    // Single-session enforcement: this account just signed in elsewhere,
    // so login_id changed and this token is already dead (authMiddleware).
    // Pushed over the socket so the old screen reacts at once instead of
    // waiting for its next request to 401 — i.e. instead of needing a reload.
    SESSION_TAKEN_OVER: "You have been logged out because this account signed in on another device.",
    // Player toast, shown on a phone: the long form above wrapped to two
    // lines and covered the top of the login page (user, 2026-09-15). The
    // player is already staring at the login screen, so "logged out" adds
    // nothing — only the reason does. Admin keeps the full sentence; it has
    // the width for it.
    SESSION_TAKEN_OVER_PLAYER: "Logged in on another device",
    // Reference-site wording, verbatim (typo included) — the 2FA page's
    // landing toast prints this. Player login only; admin keeps its own
    // ADMIN.AUTH.OTP_SENT below.
    OTP_SENT: "Sucessfully Code Generate.",
    LOGIN_FAILED: "Failed to login user",
    // Demo login (POST /user/demo-login) — a real throwaway account.
    DEMO_LOGIN_SUCCESS: "Demo login successful",
    DEMO_DISABLED: "Demo login is not available right now",
    DEMO_RATE_LIMITED: "Too many demo logins from this device. Please try again later.",
    DEMO_EXPIRED: "Demo session expired. Please login again.",
    OTP_EXPIRED_OR_NOT_REQUESTED: "OTP expired or not requested",
    INVALID_OTP: "Invalid OTP",
    // Login 2FA: a generated code is good for MAX_LOGIN_OTP_ATTEMPTS tries.
    // Reference text captured 2026-09-20 (iOS toast): "token code not valid.
    // You have 5attempt left" — no space before "attempt", keep it as is,
    // same shape as the transaction-code line below.
    TOKEN_NOT_VALID_ATTEMPTS_LEFT: (n) => `token code not valid. You have ${n}attempt left`,
    // ── Telegram bot texts ────────────────────────────────────────────
    // Captured from the reference bot "Securisep Authentication"
    // (screenshot 2026-09-20 4:31): the login code line carries the code
    // AND the username, with "not" bold — the wording Telegram's own login
    // message uses. The reference's own copy has a double space before the
    // username and a space before the full stop; the user asked for those
    // extras to go (2026-09-20), so it is single-spaced here.
    // NOTE: it says "30 sec" while our cached OTP lives 5 minutes; text
    // copied verbatim, see the plan's open question.
    TELEGRAM_LOGIN_CODE: (otp, username) => `<b>Login Code: ${otp} ${username}.</b> Do <b>not</b> give this code to anyone, even if they say they are from Telegram! Its valid for 30 sec.`,
    TELEGRAM_2FA_ENABLED: "2-Step Verification is enabled, Now you can use this bot to login into your account.",
    TELEGRAM_2FA_DISABLED: "2-Step Verification is disabled for your account.",
    OTP_EXPIRED: "OTP expired",
    TWO_FA_FAILED: "2FA Verification failed",
    TWO_FA_NOT_ENABLED: "2FA not enabled",
    LOGOUT_FAILED: "Failed to logout user",
    OTP_RESEND_FAILED: "Failed to resend OTP",
    INCORRECT_CURRENT_PASSWORD: "Password is Wrong",
    // New password identical to the one already on the account.
    PASSWORD_SAME_AS_OLD: "Password Must not be same as previous password.",
    PASSWORD_CHANGE_FAILED: "Failed to change password",
    // Account was created with the "Password Change" box ticked (or its
    // direct parent was) — see helper/passwordChangePermission.js.
    PASSWORD_CHANGE_NOT_ALLOWED: "Password cannot be changed",
    TERMS_AGREE_REQUIRED: "Please agree Terms and Conditions",
    // Reference re-login rule (frontend utils/reloginGuard.js): first login
    // with a different account after a logout is refused with this + reload.
    RELOAD_AND_RETRY: "Please reload page and retry !",
    // Google Authenticator (TOTP) secure auth
    GOOGLE_AUTH_SETUP_READY: "Scan the QR code in Google Authenticator",
    GOOGLE_AUTH_ENABLED: "Google Authenticator enabled successfully",
    GOOGLE_AUTH_DISABLED: "Google Authenticator disabled successfully",
    GOOGLE_AUTH_NOT_SETUP: "Google Authenticator setup not started. Please scan the QR code first.",
    GOOGLE_AUTH_NOT_ENABLED: "Google Authenticator is not enabled on this account",
    GOOGLE_AUTH_INVALID_CODE: "Invalid authentication code. Please try again.",
    GOOGLE_AUTH_CODE_REQUIRED: "6-digit authentication code is required",
    SECURE_AUTH_ALREADY_ENABLED: "Secure auth verification is already enabled. Disable it first.",
    // "Secure Auth Verification App" (Android, offline TOTP) secure auth
    ANDROID_AUTH_PAIR_READY: "Enter this code in your Secure Auth Verification App",
    ANDROID_AUTH_PAIRED: "Account added. Secure auth is now enabled.",
    ANDROID_AUTH_PAIR_INVALID: "This auth code is invalid or has expired. Please generate a new one.",
    ANDROID_AUTH_CODE_REQUIRED: "6-digit auth code is required",
    ANDROID_AUTH_CREDENTIALS_REQUIRED: "Please enter your username and password",
    ANDROID_AUTH_CREDENTIALS_INVALID: "Username or password is not valid for this auth code.",
    ANDROID_AUTH_NOT_PAIRED: "Secure Auth Verification App is not paired yet. Generate an auth code first.",
    ANDROID_AUTH_NOT_ENABLED: "Secure Auth Verification App is not enabled on this account",
    ANDROID_AUTH_ENABLED: "Secure Auth Verification App enabled successfully",
    ANDROID_AUTH_DISABLED: "Secure Auth Verification App disabled successfully",
    ANDROID_AUTH_TOO_MANY_ATTEMPTS: "Too many attempts. Please wait a minute and try again."
  },
  VALIDATION: {
    FIELD_REQUIRED: "This field is required",
    USERNAME_REQUIRED: "Username required",
    PASSWORD_REQUIRED: "Password required"
  },
  PASSWORD: {
    MUST_BE_NON_EMPTY: "Password must be a non-empty string",
    CANNOT_BE_WHITESPACE: "Password cannot be empty or whitespace only",
    HASH_FAILED: "Failed to hash password",
    HASHED_MUST_BE_NON_EMPTY: "Hashed password must be a non-empty string",
    COMPARE_FAILED: "Failed to compare passwords",
    SALT_GENERATION_FAILED: "Failed to generate salt",
    SALT_MUST_BE_NON_EMPTY: "Salt must be a non-empty string",
    HASH_WITH_SALT_FAILED: "Failed to hash password with salt",
    MIN_LENGTH: (minLength) => `Password must be at least ${minLength} characters long`,
    NEED_LOWERCASE: "Password must contain at least one lowercase letter",
    NEED_NUMBER: "Password must contain at least one number",
    NEED_SPECIAL_CHAR: "Password must contain at least one special character"
  },
  BET: {
    // Bet lock on the player or any staff above them — sports
    // placeBet (services/BetLockService.js). Also the forceLogout toast.
    LOCKED_CONTACT_UPLINE: "Bet is locked. Please contact upper level 1.",
    // General Lock (sports-lock) — n = role number of the locker
    // (Agent 1, Master 2, … Owner 7; see uplineNo in SportsLockController).
    GAME_LOCKED_CONTACT_UPLINE: (n) => `Game is locked. Please contact Upper Level${n}`,
    // Owner-set Max Odds (admin Settings → Max Odds). `scope` is the sport
    // name, or LIMITED_OVERS_SCOPE for a cricket "Oneday & T20 only" cell.
    // Always 2 decimals — reference: "Bet Not Accept Rate Over 4.00 on Oneday and T20".
    // Frontend twin: frontend/src/utils/betToastMessages.js RATE_OVER_LIMIT.
    RATE_OVER_LIMIT: (max, scope) => `Bet Not Accept Rate Over ${Number(max).toFixed(2)} on ${scope}`,
    LIMITED_OVERS_SCOPE: "Oneday and T20",
    // Server-side bet buffer (sportsbet/betBuffer.js) — verbatim twins of
    // frontend/src/utils/betToastMessages.js, so the toast a player sees
    // did not change when these checks moved off the browser.
    GAME_SUSPEND: "Bet Not Confirmed due to game suspend.",
    BALL_RUNNING: "Ball Running",
    ODDS_CHANGED: "Odds changed",
    ODDS_CHANGE_NOT_CONFIRMED: "Bet not confirm Odds change",
    UNMATCHED_NOT_ALLOWED: "Unmatched bet not allowed.",
    RANGE_NOT_VALID: "Bet Not Confirm Reason Min and Max Bet Range Not Valid.",
    // Same client_ref submitted again while the first one is still buffering.
    BET_ALREADY_PENDING: "Bet is already being placed."
  },
  ADMIN: {
    AUTH: {
      // ── Sab admin logins pe common ──────────────────────────────
      // Account exist na kare — staff aur owner, dono ke login/2FA/profile pe yahi text.
      // NOTE: admin/src/hooks/useAuth.js ka staff→executive cascade is text pe
      // /not found|not available/i match karta hai — "not available" hataana mat.
      ACCOUNT_NOT_AVAILABLE: "UserName not available",
      // Admin ka apna wording — player side AUTH.PASSWORD_WRONG use karta hai.
      // Executive login isko tab bhi bhejta hai jab username exist na kare —
      // jaan-bujh ke, taaki bahar se account ka hona pata na chale.
      PASSWORD_INCORRECT: "Password Incorrect",
      OTP_SENT: "2FA OTP sent to your linked Telegram",
      // ── Staff ───────────────────────────────────────────────────
      MISSING_STAFFID_OR_OTP: "Staff ID and OTP required",
      STAFF_ID_MISSING_TOKEN: "Invalid token payload: staff_id missing",
      STAFF_ID_MISSING: "staff_id missing (send it in the payload or use a valid token)",
      STAFF_LOGIN_FAILED: "Failed to login staff",
      STAFF_LOGOUT_FAILED: "Failed to logout staff",
      STAFF_PROFILE_FETCH_FAILED: "Failed to fetch staff profile",
      // Telegram body — HTML parse mode, isliye <b> tags.
      // Same reference bot line as the player side (MESSAGES.AUTH.
      // TELEGRAM_LOGIN_CODE) — one bot, one wording.
      TELEGRAM_STAFF_LOGIN_OTP: (otp, username) => MESSAGES.AUTH.TELEGRAM_LOGIN_CODE(otp, username),
      // ── Owner ───────────────────────────────────────────────────
      MISSING_OWNERID_OR_OTP: "Owner ID and OTP required",
      OWNER_ID_MISSING_TOKEN: "Invalid token payload: owner_id missing",
      OWNER_ID_MISSING: "owner_id missing (send it in the payload or use a valid token)",
      OWNER_LOGIN_FAILED: "Failed to login owner",
      OWNER_LOGOUT_FAILED: "Failed to logout owner",
      OWNER_PROFILE_FETCH_FAILED: "Failed to fetch owner profile",
      // Same reference bot line as the player side (MESSAGES.AUTH.
      // TELEGRAM_LOGIN_CODE) — one bot, one wording.
      TELEGRAM_OWNER_LOGIN_OTP: (otp, username) => MESSAGES.AUTH.TELEGRAM_LOGIN_CODE(otp, username),
      // ── Executive (multi-login) ─────────────────────────────────
      // Executive login me email field nahi hai, isliye shared
      // AUTH.CREDENTIALS_REQUIRED se alag wording.
      EXECUTIVE_CREDENTIALS_REQUIRED: "Username and password are required",
      EXECUTIVE_DISABLED: "Executive account is disabled"
    },
    // Activity log ki details — admin ke Activity Log report me dikhti hain.
    ACTIVITY: {
      STAFF_LOGIN: "Staff login successful",
      STAFF_2FA: "Staff 2FA verified",
      OWNER_LOGIN: "Owner login successful",
      OWNER_2FA: "Owner 2FA verified"
    },
    // Owner ke platform / site settings.
    SETTINGS: {
      PLATFORM_CONFIG_REQUIRED: "Platform configurations are required",
      PLATFORM_CONFIG_UPDATED: "Platform configurations updated successfully",
      PLATFORM_CONFIG_UPDATE_FAILED: "Failed to update platform configurations"
    },
    // Create Account (insertuser) — user + staff dono.
    USERS: {
      // Create Account: the username is already a user, staff or owner
      // name (case-insensitive). Sent by check-username (202), the
      // player create route (400) and the staff create route (409); the
      // admin shows this text as its toast, verbatim — reference wording.
      USERNAME_EXISTS: "User Name Already Exists",
      // Create Account: a negative (or non-numeric) credit amount.
      // Reference wording verbatim — lower-case, one word, trailing dot
      // (reference toast captured 2026-09-21 for an entry of -37).
      CREDIT_AMOUNT_INVALID: "creditamount is invalid.",
      // Create Account: no role picked, or a role this API does not know.
      // Reference wording verbatim (capital S, lower-case "type").
      SELECT_PROPER_USER_TYPE: "Select Proper User type",
      // Reference wording verbatim (typo included). Parent ka balance
      // credit se kam ho to account 0 credit pe banta hai; bal = parent
      // wallet ka asli inr_balance.
      CREATED_INSUFFICIENT_CREDIT: (bal) => `User Sucessfully Inserted But Your Client Does Not Have Sufficient Credit, Because Client Credit is : ${Number(bal).toFixed(2)}`,
      // Credit Withdraw (Credit Activity modal): child ka main balance
      // (USER → cash, staff → inr_balance) withdraw amount se kam.
      // Reference wording verbatim; bal = child ka asli balance. The
      // admin shows this as its error toast, text from here.
      WITHDRAW_INSUFFICIENT_BALANCE: (bal) => `Your Client Does Not Have Sufficient Balance, Because Client Balance is : ${Number(bal).toFixed(2)}`,
      // Credit Deposit (same modal): the SENDER (logged-in parent) has
      // less inr_balance than the deposit. Reference wording verbatim;
      // bal = sender's actual balance. Error toast in the admin.
      DEPOSIT_INSUFFICIENT_CREDIT: (bal) => `Your Client Does Not Have Sufficient Credit, Because Client Credit is : ${Number(bal).toFixed(2)}`,
      // Credit Deposit AND Credit Withdraw succeeded — the admin toasts
      // this on both (user, 2026-09-17: "dono ke case me same"). Reference
      // wording verbatim ("Sucessfull" typo included).
      BALANCE_TRANSFER_SUCCESS: "Sucessfull Balance Transfer"
    },
    // Transaction code (a.k.a. master password) — ONE set of strings for
    // every route that runs verifyTransactionPassword / the attempts
    // service (deposit, withdraw, create account, edit profile, lock,
    // settlement …). Controllers never spell these out inline.
    TXN: {
      REQUIRED: "Transaction password is required",
      ACCOUNT_NOT_FOUND: "User not found",
      // Reference-site wording, verbatim — including the missing space
      // before "attempt", the singular whatever the count, the lowercase
      // "t" and the FULL STOP at the end. Match it, do not tidy it.
      // First noted 2026-09-16 as "You have 8attempt left"; the full stop
      // was missed then and is plain in the 2026-09-21 phone recording of
      // General Lock: "transaction code not valid. You have 7attempt left."
      NOT_VALID_ATTEMPTS_LEFT: (n) => `transaction code not valid. You have ${n}attempt left.`,
      // The allowance is used up (counter at 0, staff deactivated) — and
      // every later attempt while still deactivated. Same text on every
      // transaction-code route (user, 2026-09-18).
      LIMIT_REACHED: "Unauthorized access",
      VERIFIED: "Transaction password verified",
      // Bet Lock says it differently. The operator ticks an account with
      // the Transaction Code box filled in, and a wrong code comes back
      // as this — user's toast DOM, 2026-09-23, full stop included. Only
      // the market-lock routes use it; every other transaction-code route
      // keeps NOT_VALID_ATTEMPTS_LEFT above.
      MASTER_NOT_VALID: "Master Password not valid."
    }
  }
};

export { MESSAGES };
