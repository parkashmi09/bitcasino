'use strict';

/**
 * Relationships between models.
 *
 * Kept out of the generated files on purpose: the generator rewrites those on
 * every schema change, and associations are a design decision, not a
 * transcription of the DDL.
 *
 * Two kinds live here:
 *   1. Real foreign keys from the schema.
 *   2. Logical links the legacy schema never declared — `credits.uid`,
 *      `bets.uid`, `SportsBet.user_id` all point at `users.id` without a
 *      constraint. Declaring them gives us joins and eager loading without
 *      adding constraints to a live table.
 *
 * Every wiring goes through `link()`, which checks that both columns actually
 * exist first. With 130 generated models and a legacy schema that spells the
 * same concept `uid`, `user_id` and `login` depending on the table, an
 * unchecked association fails at boot with a stack trace that names neither the
 * model nor the column. This turns that into a skipped link and a warning.
 */

/** Association kinds we use, mapped to the Sequelize method. */
const KINDS = { hasOne: 'hasOne', hasMany: 'hasMany', belongsTo: 'belongsTo' };

function createLinker(models, logger) {
  const skipped = [];

  const hasAttribute = (model, attribute) =>
    Boolean(model && attribute && Object.prototype.hasOwnProperty.call(model.rawAttributes, attribute));

  /**
   * Wire one association, both directions, only if every named column exists.
   *
   * @param {object} spec
   * @param {string} spec.from        Source model name.
   * @param {string} spec.to          Target model name.
   * @param {string} spec.kind        hasOne | hasMany
   * @param {string} spec.foreignKey  Column on the TARGET pointing back.
   * @param {string} spec.sourceKey   Column on the SOURCE being pointed at.
   * @param {string} spec.as          Alias for source -> target.
   * @param {string} [spec.inverseAs] Alias for target -> source. Omit to skip the inverse.
   * @param {boolean} [spec.constraints] True only for real database FKs.
   */
  function link({ from, to, kind = KINDS.hasMany, foreignKey, sourceKey, as, inverseAs, constraints = false }) {
    const source = models[from];
    const target = models[to];

    if (!source || !target) {
      skipped.push({ from, to, as, reason: `model ${!source ? from : to} not loaded` });
      return false;
    }
    if (!hasAttribute(target, foreignKey)) {
      skipped.push({ from, to, as, reason: `${to}.${foreignKey} does not exist` });
      return false;
    }
    if (!hasAttribute(source, sourceKey)) {
      skipped.push({ from, to, as, reason: `${from}.${sourceKey} does not exist` });
      return false;
    }

    source[kind](target, { foreignKey, sourceKey, as, constraints });
    if (inverseAs) {
      target.belongsTo(source, { foreignKey, targetKey: sourceKey, as: inverseAs, constraints });
    }
    return true;
  }

  const report = () => {
    if (!skipped.length) return;
    logger?.debug({ skipped }, `${skipped.length} association(s) skipped — column not present in this schema`);
  };

  return { link, report, skipped };
}

function applyAssociations(models, logger) {
  const { link, report, skipped } = createLinker(models, logger);

  // ── Player identity and money ───────────────────────────────────────
  // Balances live in a single wide `credits` row (one column per currency),
  // which is why this is hasOne rather than hasMany.
  link({ from: 'Users', to: 'Credits', kind: KINDS.hasOne, foreignKey: 'uid', sourceKey: 'id', as: 'credits', inverseAs: 'user' });

  // credits_ledger.user_id is TEXT in the legacy schema, so this join is
  // declared without constraints and cast at query time where needed.
  link({ from: 'Users', to: 'CreditsLedger', foreignKey: 'user_id', sourceKey: 'id', as: 'ledgerEntries' });

  // A settlement ledger row points back at the bet it settled. Unlike user_id
  // above, `credits_ledger.bet_id` and `SportsBet.id` are both numeric, so this
  // one is a usable join rather than a cast — the settled-market views rely on
  // it to read match_title / team names off the bet.
  link({
    from: 'SportsBet',
    to: 'CreditsLedger',
    foreignKey: 'bet_id',
    sourceKey: 'id',
    as: 'settlementLedger',
    inverseAs: 'bet',
  });

  link({ from: 'Users', to: 'Wallets', foreignKey: 'uid', sourceKey: 'id', as: 'depositAddresses', inverseAs: 'user' });

  /**
   * Everything a player owns. The foreign key column differs per table because
   * the legacy schema was never normalised — `uid` on the older tables,
   * `user_id` on the newer ones. Naming each explicitly beats guessing.
   */
  const userOwned = [
    ['WalletHistory', 'uid', 'walletHistory'],
    ['Tokens', 'uid', 'legacyTokens'],
    ['User2fa', 'uid', 'twoFactor'],
    ['UserOtps', 'user_id', 'otps'],
    ['UserKyc', 'user_id', 'kycDocuments'],
    ['UserLoginHistory', 'user_id', 'loginHistory'],
    ['Userconfig', 'uid', 'config'],
    ['UserExposures', 'user_id', 'exposures'],
    ['Userwager', 'uid', 'wager'],
    ['UserwagerHistory', 'uid', 'wagerHistory'],
    ['Bets', 'uid', 'casinoBets'],
    ['SportsBet', 'user_id', 'sportsBets'],
    ['Deposits', 'uid', 'deposits'],
    ['Withdrawals', 'uid', 'withdrawals'],
    ['FiatDeposits', 'user_id', 'fiatDeposits'],
    ['FiatWithdrawals', 'uid', 'fiatWithdrawals'],
    ['GisSessions', 'user_id', 'gisSessions'],
    ['GisTransactions', 'user_id', 'gisTransactions'],
    ['JsGameSessions', 'user_id', 'jsGameSessions'],
    ['JsGameTransactions', 'user_id', 'jsGameTransactions'],
    // Auth tables added on top of the baseline (migration 001).
    ['AuthSession', 'user_id', 'sessions'],
    ['AuthVerificationToken', 'user_id', 'verificationTokens'],
  ];

  for (const [to, foreignKey, as] of userOwned) {
    link({ from: 'Users', to, foreignKey, sourceKey: 'id', as, inverseAs: 'user' });
  }

  // ── Staff hierarchy ─────────────────────────────────────────────────
  // Every player belongs to the staff member (agent) who created them. That
  // link drives commission, exposure limits and the whole admin tree.
  link({ from: 'Staff', to: 'Users', foreignKey: 'parent_staff_id', sourceKey: 'id', as: 'players', inverseAs: 'parentStaff' });

  link({ from: 'Roles', to: 'Staff', foreignKey: 'role_id', sourceKey: 'id', as: 'staff', inverseAs: 'role' });

  // Self-referencing agent tree: an agent reports to a super-agent.
  link({ from: 'Staff', to: 'Staff', foreignKey: 'parent_id', sourceKey: 'id', as: 'children', inverseAs: 'parent' });

  link({ from: 'Staff', to: 'StaffBalances', kind: KINDS.hasOne, foreignKey: 'staff_id', sourceKey: 'id', as: 'balance', inverseAs: 'staff' });

  // Closure table: one row per ancestor/descendant pair, so "everyone under
  // this agent" is a single indexed lookup instead of a recursive walk.
  link({ from: 'Staff', to: 'StaffHierarchy', foreignKey: 'ancestor_id', sourceKey: 'id', as: 'descendantLinks' });
  link({ from: 'Staff', to: 'StaffHierarchy', foreignKey: 'descendant_id', sourceKey: 'id', as: 'ancestorLinks' });

  // staff_transfers is polymorphic (from_type/from_id, to_type/to_id), so it
  // deliberately has no association — resolve it in the repository instead.

  // ── Executives (restricted sub-accounts of a staff member) ──────────
  link({
    from: 'Staff',
    to: 'Executives',
    foreignKey: 'parent_staff_id',
    sourceKey: 'id',
    as: 'executives',
    inverseAs: 'parentStaff',
    constraints: true,
  });

  link({
    from: 'Executives',
    to: 'ExecutiveActivityLogs',
    foreignKey: 'executive_id',
    sourceKey: 'id',
    as: 'activityLogs',
    inverseAs: 'executive',
    constraints: true,
  });

  link({ from: 'Staff', to: 'AdminActivityLogs', foreignKey: 'staff_id', sourceKey: 'id', as: 'activityLogs', inverseAs: 'staff', constraints: true });
  link({ from: 'Executives', to: 'AdminActivityLogs', foreignKey: 'executive_id', sourceKey: 'id', as: 'adminActivityLogs', inverseAs: 'executive', constraints: true });

  // ── Clubs ───────────────────────────────────────────────────────────
  link({ from: 'Users', to: 'Clubs', foreignKey: 'owner_id', sourceKey: 'id', as: 'ownedClubs', inverseAs: 'owner' });
  link({ from: 'Clubs', to: 'ClubHierarchy', foreignKey: 'ancestor_id', sourceKey: 'id', as: 'descendantLinks' });
  link({ from: 'Clubs', to: 'ClubHierarchy', foreignKey: 'descendant_id', sourceKey: 'id', as: 'ancestorLinks' });

  // ── Gift cards ──────────────────────────────────────────────────────
  link({ from: 'GiftCards', to: 'UserGiftCards', foreignKey: 'gift_card_id', sourceKey: 'id', as: 'issued', inverseAs: 'giftCard', constraints: true });

  // ── Casino sessions ─────────────────────────────────────────────────
  link({ from: 'GisSessions', to: 'GisTransactions', foreignKey: 'session_id', sourceKey: 'session_id', as: 'transactions', inverseAs: 'session' });
  link({ from: 'GisGames', to: 'GisSessions', foreignKey: 'game_uuid', sourceKey: 'uuid', as: 'sessions', inverseAs: 'game' });
  link({ from: 'GisGames', to: 'GisTransactions', foreignKey: 'game_uuid', sourceKey: 'uuid', as: 'transactions', inverseAs: 'game' });

  // js_game_transactions has no session column — it links to the game directly.
  link({ from: 'JsGames', to: 'JsGameSessions', foreignKey: 'game_uid', sourceKey: 'game_uid', as: 'sessions', inverseAs: 'game' });
  link({ from: 'JsGames', to: 'JsGameTransactions', foreignKey: 'game_uid', sourceKey: 'game_uid', as: 'transactions', inverseAs: 'game' });

  report();
  return { skipped };
}

module.exports = { applyAssociations, createLinker, KINDS };
