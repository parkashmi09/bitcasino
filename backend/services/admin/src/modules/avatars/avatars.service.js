'use strict';

const crypto = require('node:crypto');
const { imageUpload } = require('@ibitplay/common');

const errors = require('./avatars.errors');
const { MAX_AVATAR_BYTES } = require('./avatars.constants');

/** Every column except the bytes — a list must not drag the images through the query. */
const META = ['id', 'content_type', 'byte_size', 'version', 'min_level', 'sort', 'enabled', 'updated_at'];

const versionOf = (data) => crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);

/** Where the bytes are served: the version makes the URL immutable. */
const urlOf = (row) => `/api/v1/admin/avatars/${row.id}/image?v=${row.version}`;

/** The player-facing shape: `GET /admin/avatars/public` and the sync socket. */
const publicView = (row) => ({ id: row.id, url: urlOf(row), minLevel: row.min_level, sort: row.sort });

const staffView = (row) => ({
  id: row.id,
  url: urlOf(row),
  minLevel: row.min_level,
  sort: row.sort,
  enabled: row.enabled !== false,
  byteSize: row.byte_size,
  contentType: row.content_type,
  updatedAt: row.updated_at ?? null,
});

/** Check an upload on its bytes (PNG / JPEG / WebP, at most 1 MB), throwing in `AVATARS_*`. */
const inspect = (file) => imageUpload.inspect(file, errors, { maxBytes: MAX_AVATAR_BYTES });

class AvatarsService {
  constructor({ models, logger }) {
    this.models = models;
    this.logger = logger;
  }

  async publicList() {
    const rows = await this.models.Avatar.findAll({
      where: { enabled: true },
      attributes: META,
      order: [['sort', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
    return rows.map(publicView);
  }

  async list() {
    const rows = await this.models.Avatar.findAll({ attributes: META, order: [['sort', 'ASC'], ['id', 'ASC']], raw: true });
    return rows.map(staffView);
  }

  /** For user-service's avatar check: `{ id, url, minLevel, enabled }`. */
  async byId(id) {
    const row = await this.models.Avatar.findByPk(id, { attributes: META, raw: true });
    if (!row) throw errors.NOT_FOUND({ id });
    return { id: row.id, url: urlOf(row), minLevel: row.min_level, enabled: row.enabled !== false };
  }

  async imageBytes(id) {
    const row = await this.models.Avatar.findByPk(id, { raw: true });
    // A disabled avatar is still served: players who picked it keep showing it.
    if (!row?.image_data) throw errors.NOT_FOUND({ id });
    return {
      data: Buffer.from(row.image_data),
      contentType: row.content_type,
      byteSize: row.byte_size ?? row.image_data.length,
      version: row.version,
      updatedAt: row.updated_at ?? null,
    };
  }

  async create({ staff, file, minLevel = 0, sort, enabled = true }) {
    const image = inspect(file);
    const nextSort = sort ?? ((await this.models.Avatar.max('sort')) || 0) + 1;
    const row = await this.models.Avatar.create({
      image_data: image.data,
      content_type: image.contentType,
      byte_size: image.byteSize,
      version: versionOf(image.data),
      min_level: minLevel,
      sort: nextSort,
      enabled,
      updated_by: staff?.id ?? null,
    });
    this.logger?.info({ id: row.id, staffId: staff?.id, bytes: image.byteSize, minLevel }, 'Avatar uploaded');
    return staffView(row.get({ plain: true }));
  }

  async update({ staff, id, minLevel, sort, enabled }) {
    const patch = {
      ...(minLevel !== undefined ? { min_level: minLevel } : {}),
      ...(sort !== undefined ? { sort } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
      updated_by: staff?.id ?? null,
    };
    const [affected] = await this.models.Avatar.update(patch, { where: { id } });
    if (!affected) throw errors.NOT_FOUND({ id });
    return staffView(await this.models.Avatar.findByPk(id, { attributes: META, raw: true }));
  }

  async replaceImage({ staff, id, file }) {
    const image = inspect(file);
    const [affected] = await this.models.Avatar.update(
      {
        image_data: image.data,
        content_type: image.contentType,
        byte_size: image.byteSize,
        version: versionOf(image.data),
        updated_by: staff?.id ?? null,
      },
      { where: { id } }
    );
    if (!affected) throw errors.NOT_FOUND({ id });
    return staffView(await this.models.Avatar.findByPk(id, { attributes: META, raw: true }));
  }

  async remove({ staff, id }) {
    const affected = await this.models.Avatar.destroy({ where: { id } });
    if (!affected) throw errors.NOT_FOUND({ id });
    this.logger?.info({ id, staffId: staff?.id }, 'Avatar deleted');
    return { id, deleted: true };
  }
}

module.exports = { AvatarsService, publicView, staffView, urlOf, versionOf };
