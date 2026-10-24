// services/user/StakeButtonService.js — mssports core, moved unchanged
import { StakeButtonValue_default } from "../../../models/user/StakeButtonValue.mjs";

var DEFAULT_GAME_BUTTONS = [
  { label: "1k", value: 1e3 },
  { label: "2k", value: 2e3 },
  { label: "5k", value: 5e3 },
  { label: "10k", value: 1e4 },
  { label: "20k", value: 2e4 },
  { label: "25k", value: 25e3 }
];
var tableReady = null;
var ensureTable = () => {
  if (!tableReady) {
    tableReady = StakeButtonValue_default.sync().catch((e) => {
      tableReady = null;
      throw e;
    });
  }
  return tableReady;
};
var MAX_GAME_BUTTONS = 6;
var cleanButtons = (list, fallback, max = Infinity) => {
  if (!Array.isArray(list)) return fallback;
  const rows = list.filter((b) => b && Number(b.value) > 0).map((b) => ({ label: String(b.label ?? "").trim(), value: Number(b.value) })).slice(0, max);
  return rows.length ? rows : fallback;
};
var seedForUser = async (userId, transaction = void 0) => {
  if (!userId) return null;
  try {
    await ensureTable();
    const [row] = await StakeButtonValue_default.findOrCreate({
      where: { user_id: userId },
      defaults: {
        user_id: userId,
        game_buttons: DEFAULT_GAME_BUTTONS
      },
      ...transaction ? { transaction } : {}
    });
    return row;
  } catch (err) {
    console.error("seedForUser (stake buttons) failed for user", userId, err.message);
    return null;
  }
};

export { DEFAULT_GAME_BUTTONS, ensureTable, MAX_GAME_BUTTONS, cleanButtons, seedForUser };
