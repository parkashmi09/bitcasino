// model/associations.js — mssports core, moved unchanged
import { User_default } from "./user/User.mjs";
import { BetLock_default } from "./admin/BetLock.mjs";
import { Wallet_default } from "./admin/Wallet.mjs";
import { SportsBet_default } from "./user/SportsBet.mjs";

User_default.hasOne(BetLock_default, {
  foreignKey: "user_id",
  as: "betlock",
  onDelete: "CASCADE"
});
BetLock_default.belongsTo(User_default, {
  foreignKey: "user_id",
  as: "user"
});
Wallet_default.belongsTo(User_default, {
  foreignKey: "user_id",
  as: "user",
  constraints: false
});
SportsBet_default.belongsTo(User_default, {
  foreignKey: "user_id",
  as: "user"
});
