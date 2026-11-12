'use strict';
const { newId } = require('../util/crypto');
const { badRequest, notFound, conflict } = require('../domain/errors');
const { CHANNELS, isPlainObject } = require('../domain/validators');
const { extractPlaceholders, assertSyntax } = require('../domain/templateEngine');
const { isUniqueViolation } = require('../db/createDatabase');

const toApi = (t) => ({
  id: t.id, name: t.name, channel: t.channel, status: t.status, version: t.current_version,
  subject: t.subject, body: t.body, placeholders: JSON.parse(t.placeholders), createdAt: t.created_at, updatedAt: t.updated_at,
});

/** FR-04 / FR-05: reusable templates with {{placeholders}} and automatic versioning. */
class TemplateService {
  constructor({ db, templates }) { this.db = db; this.templates = templates; }

  _content(channel, input) {
    const subject = input.subject === undefined || input.subject === null ? null : input.subject;
    const body = input.body;
    if (typeof body !== 'string' || !body.trim()) throw badRequest('body is required', { field: 'body' });
    if (body.length > 20000) throw badRequest('body is too long (max 20000 characters)', { field: 'body' });
    if (subject !== null && (typeof subject !== 'string' || subject.length > 300)) throw badRequest('subject must be a string of at most 300 characters', { field: 'subject' });
    if (channel === 'email' && !(subject && subject.trim())) throw badRequest('subject is required for email templates', { field: 'subject' });
    if (subject) assertSyntax(subject, 'subject');
    assertSyntax(body, 'body');
    const placeholders = [...new Set([...extractPlaceholders(subject), ...extractPlaceholders(body)])];
    return { subject, body, placeholders };
  }

  async create(tenantId, input) {
    if (!isPlainObject(input)) throw badRequest('Request body must be a JSON object');
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 100) throw badRequest('name is required (max 100 characters)', { field: 'name' });
    if (!CHANNELS.includes(input.channel)) throw badRequest(`channel must be one of: ${CHANNELS.join(', ')}`, { field: 'channel' });
    const content = this._content(input.channel, input);
    if (await this.templates.findByName(tenantId, name)) throw conflict(`A template named "${name}" already exists`, 'duplicate_template');

    const now = new Date().toISOString();
    const id = newId();
    try {
      await this.db.transaction(async (tx) => {
        await this.templates.insertTemplate({ id, tenantId, name, channel: input.channel, createdAt: now }, tx);
        await this.templates.insertVersion({ id: newId(), templateId: id, tenantId, version: 1, ...content, createdAt: now }, tx);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(`A template named "${name}" already exists`, 'duplicate_template');
      throw err;
    }
    return toApi(await this.templates.findById(tenantId, id));
  }

  async get(tenantId, id) {
    const t = await this.templates.findById(tenantId, id);
    if (!t) throw notFound('Template not found', 'template_not_found');
    return toApi(t);
  }

  async list(tenantId, { includeArchived = false } = {}) {
    return (await this.templates.list(tenantId, { includeArchived })).map(toApi);
  }

  async versions(tenantId, id) {
    await this.get(tenantId, id);
    return (await this.templates.versions(tenantId, id)).map((v) => ({ version: v.version, subject: v.subject, body: v.body, placeholders: JSON.parse(v.placeholders), createdAt: v.created_at }));
  }

  /** FR-05: an edit never overwrites; it creates a new version. Past notifications keep the version they used. */
  async update(tenantId, id, input) {
    if (!isPlainObject(input)) throw badRequest('Request body must be a JSON object');
    const current = await this.templates.findById(tenantId, id);
    if (!current) throw notFound('Template not found', 'template_not_found');
    if (current.status === 'archived') throw conflict('This template is archived and cannot be edited', 'template_archived');
    const content = this._content(current.channel, {
      subject: input.subject === undefined ? current.subject : input.subject,
      body: input.body === undefined ? current.body : input.body,
    });
    const now = new Date().toISOString();
    await this.db.transaction(async (tx) => {
      const bumped = await this.templates.bumpVersion(tenantId, id, now, tx);
      if (!bumped) throw conflict('This template is archived and cannot be edited', 'template_archived');
      await this.templates.insertVersion({ id: newId(), templateId: id, tenantId, version: bumped.current_version, ...content, createdAt: now }, tx);
    });
    return toApi(await this.templates.findById(tenantId, id));
  }

  async archive(tenantId, id) {
    await this.get(tenantId, id);
    await this.templates.archive(tenantId, id, new Date().toISOString());
    return this.get(tenantId, id);
  }
}
module.exports = { TemplateService };
