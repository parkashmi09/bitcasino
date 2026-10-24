'use strict';

const { AppError } = require('@ibitplay/common');

const { treeOf, searchClients } = require('./reportScope');
const { statement, betDetail, betExport } = require('./accountStatement');
const { partyWinLoss, userWinLoss, directUserWinLoss, totalProfitLoss, turnover } = require('./winLossReports');
const { directBetHistory } = require('./directBetHistory');

const noBets = () => new AppError('No bets found for this entry', 404, 'EXCHANGE_NO_BETS');

/**
 * Sports Exchange ke Reports (zip msadmin `reports/*`).
 * Har report login wale ke tree tak simit — owner = poori site + direct users.
 */
class ExchangeReportsService {
  constructor({ models, logger }) {
    this.models = models;
    this.logger = logger;
  }

  get sequelize() {
    return this.models.Credits.sequelize;
  }

  #tree(actor, channel) {
    return treeOf(this.models, actor, this.logger, channel);
  }

  /** "Search By Client Name" ke suggestions. */
  async clients({ actor, search, channel }) {
    return searchClients(this.sequelize, await this.#tree(actor, channel), search);
  }

  /** Account Statement (zip statementv2). */
  async statement({ actor, channel, ...filters }) {
    return statement(this.sequelize, await this.#tree(actor, channel), actor, filters);
  }

  /** Game row par click — Details modal. */
  async statementBetDetail({ actor, betId }) {
    const detail = await betDetail(this.sequelize, await this.#tree(actor), { betId });
    if (!detail) throw noBets();
    return detail;
  }

  /** Game row ka Excel icon — 13-column CSV. */
  async statementBetExport({ actor, betId }) {
    const sheet = await betExport(this.sequelize, await this.#tree(actor), { betId });
    if (!sheet) throw noBets();
    return sheet;
  }

  async partyWinLoss({ actor, type, search, channel }) {
    return partyWinLoss(this.sequelize, await this.#tree(actor, channel), { type, search });
  }

  async userWinLoss({ actor, channel, ...filters }) {
    return userWinLoss(this.sequelize, await this.#tree(actor, channel), filters);
  }

  /** User Win Loss ka Direct Users tab — bets + mssports.credits_ledger se (direct ki point entry nahi). */
  async directUserWinLoss({ actor, ...filters }) {
    return directUserWinLoss(this.sequelize, await this.#tree(actor, 'direct'), filters);
  }

  /** Direct user ki bet history — mssports.point_ledger_direct (sports + casino, har currency). */
  async directBetHistory({ actor, ...filters }) {
    return directBetHistory(this.sequelize, await this.#tree(actor, 'direct'), filters);
  }

  async totalProfitLoss({ actor, channel, ...filters }) {
    return totalProfitLoss(this.sequelize, await this.#tree(actor, channel), filters);
  }

  async turnover({ actor, channel, ...filters }) {
    return turnover(this.sequelize, await this.#tree(actor, channel), filters);
  }

}

module.exports = { ExchangeReportsService };
