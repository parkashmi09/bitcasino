'use strict';

const crypto = require('node:crypto');

const { Op } = require('sequelize');

const { imageUpload } = require('@ibitplay/common');

const errors = require('./promotions.errors');
const { DEFAULT_PAGE_SIZE, MAX_SLUG_LENGTH, ARTICLE_EMBED_MARKER } = require('./promotions.constants');

class PromotionsService {
  constructor({ models, logger }) {
    this.models = models;
    this.logger = logger;
  }

  async list({ page = 1, limit = DEFAULT_PAGE_SIZE, segment, search, includeUnpublished = false } = {}) {
    const where = includeUnpublished ? {} : { is_published: true };

    if (segment) {
      where.segment = segment;
    }

    if (search) {
      const term = `%${search}%`;
      where[Op.or] = [{ title: { [Op.iLike]: term } }, { summary: { [Op.iLike]: term } }];
    }

    const result = await this.models.Promotions.findAndCountAll({
      where,
      attributes: this.#summaryColumns(),
      order: [
        ['featured', 'DESC'],
        [includeUnpublished ? 'created_at' : 'published_at', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
      offset: (page - 1) * limit,
      raw: true,
    });

    return {
      rows: result.rows.map((row) => this.#summarise(row)),
      count: result.count,
    };
  }

  /** Pinned links under Promotions in the player sidebar rail. */
  async sidebar({ includeUnpublished = false } = {}) {
    const rows = await this.models.Promotions.findAll({
      where: {
        sidebar_enabled: true,
        ...(includeUnpublished ? {} : { is_published: true }),
      },
      attributes: [
        'id',
        'segment',
        'slug',
        'title',
        'sidebar_label',
        'sidebar_icon',
        'sidebar_counter',
        'sidebar_sort',
        'ends_at',
      ],
      order: [
        ['sidebar_sort', 'ASC'],
        ['published_at', 'DESC'],
        ['id', 'DESC'],
      ],
      raw: true,
    });

    return rows.map((row) => this.#sidebarLink(row));
  }

  async bySlug({ segment, slug, includeUnpublished = false }) {
    const row = await this.models.Promotions.findOne({
      where: { segment, slug, ...(includeUnpublished ? {} : { is_published: true }) },
      attributes: this.#fullColumns(),
      raw: true,
    });

    if (!row) throw errors.NOT_FOUND({ segment, slug });
    return this.#describe(row);
  }

  async byId({ id, includeUnpublished = false }) {
    const row = await this.models.Promotions.findOne({
      where: { id, ...(includeUnpublished ? {} : { is_published: true }) },
      attributes: this.#fullColumns(),
      raw: true,
    });

    if (!row) throw errors.NOT_FOUND({ id });
    return this.#describe(row);
  }

  async image({ id, includeUnpublished = false }) {
    const row = await this.models.Promotions.findOne({
      where: { id, ...(includeUnpublished ? {} : { is_published: true }) },
      attributes: ['id', 'image_data', 'content_type', 'byte_size', 'updated_at'],
      raw: true,
    });

    if (!row) throw errors.NOT_FOUND({ id });
    if (!row.image_data) throw errors.NO_IMAGE({ id });

    return {
      data: Buffer.from(row.image_data),
      contentType: row.content_type || 'application/octet-stream',
      byteSize: row.byte_size ?? row.image_data.length,
      updatedAt: row.updated_at ?? null,
    };
  }

  async create({
    staff,
    segment,
    title,
    description,
    summary,
    termsHtml,
    imageAlt,
    featured = false,
    promoStatus = 'live',
    endsAt,
    isPublished = false,
    file,
    viewAllHref,
    qualifyingGames = [],
    sportEvents = [],
    tags = [],
    leaderboard = null,
    tournamentPanel = null,
    showInSidebar = false,
    sidebarLabel,
    sidebarIcon,
    sidebarCounter,
    sidebarSort = 0,
  }) {
    const image = file ? imageUpload.inspect(file, errors) : null;

    const slug = await this.#uniqueSlug(segment, title);
    const now = new Date();
    const bodyHtml = this.#ensureEmbedMarker(description, { leaderboard, tournamentPanel });

    const row = await this.models.Promotions.create({
      segment,
      slug,
      title,
      summary: summary ?? null,
      description: bodyHtml,
      terms_html: termsHtml?.trim() ? termsHtml.trim() : null,
      image_alt: imageAlt ?? null,
      view_all_href: viewAllHref ?? null,
      qualifying_games: qualifyingGames ?? [],
      sport_events: sportEvents ?? [],
      tags: tags ?? [],
      leaderboard: leaderboard ?? null,
      tournament_panel: tournamentPanel ?? null,
      image: image ? `${slug}${image.extension}` : null,
      image_data: image?.data ?? null,
      content_type: image?.contentType ?? null,
      byte_size: image?.byteSize ?? null,
      featured: Boolean(featured),
      promo_status: promoStatus,
      ends_at: endsAt ?? null,
      sidebar_enabled: Boolean(showInSidebar),
      sidebar_label: showInSidebar && sidebarLabel?.trim() ? sidebarLabel.trim() : null,
      sidebar_icon: showInSidebar ? sidebarIcon?.trim() || 'promotions' : null,
      sidebar_counter: showInSidebar && sidebarCounter?.trim() ? sidebarCounter.trim() : null,
      sidebar_sort: showInSidebar ? Number(sidebarSort) || 0 : 0,
      created_by: staff?.id ?? null,
      updated_by: staff?.id ?? null,
      is_published: isPublished,
      published_at: isPublished ? now : null,
      created_at: now,
      updated_at: now,
    });

    this.logger?.info(
      { promotionId: row.id, segment, slug, staffId: staff?.id, published: isPublished },
      'Promotion created'
    );

    return this.#describe(row.get({ plain: true }));
  }

  async update({ staff, id, regenerateSlug = false, file, ...fields }) {
    const row = await this.models.Promotions.findByPk(id);
    if (!row) throw errors.NOT_FOUND({ id });

    const image = file ? imageUpload.inspect(file, errors) : null;
    const updates = { updated_by: staff?.id ?? null, updated_at: new Date() };
    const segment = fields.segment ?? row.segment;

    if (fields.segment !== undefined) updates.segment = fields.segment;
    if (fields.title !== undefined) updates.title = fields.title;
    if (fields.summary !== undefined) updates.summary = fields.summary;
    if (fields.termsHtml !== undefined) updates.terms_html = fields.termsHtml?.trim() ? fields.termsHtml.trim() : null;
    if (fields.imageAlt !== undefined) updates.image_alt = fields.imageAlt;
    if (fields.featured !== undefined) updates.featured = fields.featured;
    if (fields.promoStatus !== undefined) updates.promo_status = fields.promoStatus;
    if (fields.endsAt !== undefined) updates.ends_at = fields.endsAt;
    if (fields.viewAllHref !== undefined) updates.view_all_href = fields.viewAllHref;
    if (fields.qualifyingGames !== undefined) updates.qualifying_games = fields.qualifyingGames;
    if (fields.sportEvents !== undefined) updates.sport_events = fields.sportEvents;
    if (fields.tags !== undefined) updates.tags = fields.tags;
    if (fields.leaderboard !== undefined) updates.leaderboard = fields.leaderboard;
    if (fields.tournamentPanel !== undefined) updates.tournament_panel = fields.tournamentPanel;
    if (fields.showInSidebar !== undefined) {
      updates.sidebar_enabled = fields.showInSidebar;
      if (!fields.showInSidebar) {
        updates.sidebar_label = null;
        updates.sidebar_icon = null;
        updates.sidebar_counter = null;
        updates.sidebar_sort = 0;
      }
    }
    if (fields.sidebarLabel !== undefined) updates.sidebar_label = fields.sidebarLabel?.trim() || null;
    if (fields.sidebarIcon !== undefined) updates.sidebar_icon = fields.sidebarIcon?.trim() || null;
    if (fields.sidebarCounter !== undefined) updates.sidebar_counter = fields.sidebarCounter?.trim() || null;
    if (fields.sidebarSort !== undefined) updates.sidebar_sort = fields.sidebarSort;

    const nextBoard = fields.leaderboard !== undefined ? fields.leaderboard : row.leaderboard;
    const nextPanel = fields.tournamentPanel !== undefined ? fields.tournamentPanel : row.tournament_panel;
    if (fields.description !== undefined) {
      updates.description = this.#ensureEmbedMarker(fields.description, {
        leaderboard: nextBoard,
        tournamentPanel: nextPanel,
      });
    } else if (fields.leaderboard !== undefined || fields.tournamentPanel !== undefined) {
      updates.description = this.#ensureEmbedMarker(row.description, {
        leaderboard: nextBoard,
        tournamentPanel: nextPanel,
      });
    }

    if (regenerateSlug && fields.title) {
      updates.slug = await this.#uniqueSlug(segment, fields.title, { excludeId: id });
    }

    if (fields.isPublished !== undefined) {
      updates.is_published = fields.isPublished;
      if (fields.isPublished && !row.published_at) updates.published_at = new Date();
    }

    if (image) {
      updates.image = `${updates.slug ?? row.slug}${image.extension}`;
      updates.image_data = image.data;
      updates.content_type = image.contentType;
      updates.byte_size = image.byteSize;
    }

    const changed = Object.keys(updates).filter((key) => key !== 'updated_by' && key !== 'updated_at');
    if (!changed.length) throw errors.NOTHING_TO_UPDATE({ id });

    await row.update(updates);

    this.logger?.info({ promotionId: id, staffId: staff?.id, changed }, 'Promotion updated');

    return this.#describe(row.get({ plain: true }));
  }

  async remove({ staff, id, segment, slug }) {
    const where = id !== undefined ? { id } : { segment, slug };

    const row = await this.models.Promotions.findOne({ where });
    if (!row) throw errors.NOT_FOUND({ ...where });

    await row.destroy();

    this.logger?.warn({ promotionId: row.id, slug: row.slug, staffId: staff?.id }, 'Promotion deleted');

    return { id: row.id, slug: row.slug, segment: row.segment, deleted: true };
  }

  async #uniqueSlug(segment, title, { excludeId } = {}) {
    const base =
      String(title ?? '')
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, MAX_SLUG_LENGTH)
        .replace(/-+$/, '') || 'promo';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${crypto.randomBytes(3).toString('hex')}`;

      const clash = await this.models.Promotions.findOne({
        where: { segment, slug: candidate, ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}) },
        attributes: ['id'],
        raw: true,
      });

      if (!clash) return candidate;
    }

    throw errors.SLUG_TAKEN({ base, segment });
  }

  #summaryColumns() {
    return [
      'id',
      'segment',
      'slug',
      'title',
      'summary',
      'image',
      'image_alt',
      'content_type',
      'byte_size',
      'featured',
      'promo_status',
      'ends_at',
      'sidebar_enabled',
      'is_published',
      'published_at',
      'created_at',
      'updated_at',
    ];
  }

  #fullColumns() {
    return [
      ...this.#summaryColumns(),
      'description',
      'terms_html',
      'view_all_href',
      'qualifying_games',
      'sport_events',
      'leaderboard',
      'tournament_panel',
      'tags',
      'sidebar_enabled',
      'sidebar_label',
      'sidebar_icon',
      'sidebar_counter',
      'sidebar_sort',
      'created_by',
      'updated_by',
    ];
  }

  #summarise(row) {
    if (!row) return null;
    return {
      id: row.id,
      segment: row.segment,
      slug: row.slug,
      title: row.title,
      summary: row.summary ?? null,
      imageAlt: row.image_alt ?? null,
      featured: row.featured === true,
      promoStatus: row.promo_status ?? 'live',
      endsAt: row.ends_at ?? null,
      showInSidebar: row.sidebar_enabled === true,
      sidebarLabel: row.sidebar_label ?? null,
      sidebarIcon: row.sidebar_icon ?? null,
      sidebarCounter: row.sidebar_counter ?? null,
      sidebarSort: row.sidebar_sort ?? 0,
      published: row.is_published !== false,
      publishedAt: row.published_at ?? null,
      imageUrl: row.byte_size ? `/api/v1/admin/promotions/${row.id}/image` : null,
      contentType: row.content_type ?? null,
      byteSize: row.byte_size ?? null,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
    };
  }

  #describe(row) {
    if (!row) return null;
    return {
      ...this.#summarise(row),
      description: row.description,
      termsHtml: row.terms_html ?? null,
      viewAllHref: row.view_all_href ?? null,
      qualifyingGames: row.qualifying_games ?? [],
      sportEvents: row.sport_events ?? [],
      leaderboard: row.leaderboard ?? null,
      tournamentPanel: row.tournament_panel ?? null,
      tags: row.tags ?? [],
      createdBy: row.created_by ?? null,
      updatedBy: row.updated_by ?? null,
    };
  }

  #ensureEmbedMarker(html, { leaderboard, tournamentPanel } = {}) {
    const body = String(html ?? '');
    if (!leaderboard && !tournamentPanel) return body;
    if (body.includes(ARTICLE_EMBED_MARKER)) return body;
    const accordionIdx = body.indexOf('<div class="Accordion_root">');
    if (accordionIdx > -1) {
      return `${body.slice(0, accordionIdx)}${ARTICLE_EMBED_MARKER}${body.slice(accordionIdx)}`;
    }
    return `${body}${ARTICLE_EMBED_MARKER}`;
  }

  #sidebarLink(row) {
    const href = row.segment === 'sports' ? `/sports/promotions/${row.slug}` : `/promotions/${row.slug}`;
    const counter = row.sidebar_counter?.trim() || this.#sidebarCounterFromEnds(row.ends_at);
    return {
      id: `promotion-${row.id}`,
      promotionId: row.id,
      label: row.sidebar_label?.trim() || row.title,
      href,
      icon: row.sidebar_icon?.trim() || 'promotions',
      ...(counter ? { counter } : {}),
    };
  }

  #sidebarCounterFromEnds(endsAt) {
    if (!endsAt) return null;
    const ms = new Date(endsAt).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const hours = Math.floor(ms / 3600000);
    if (hours < 48) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  }
}

module.exports = { PromotionsService };
