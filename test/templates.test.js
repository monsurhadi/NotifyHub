'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

describe('templates (FR-04, FR-05)', () => {
  let ctx;
  before(async () => { ctx = await startApp(); });
  after(async () => { await ctx.stop(); });

  it('creates a template, lists placeholders, and rejects duplicates / bad syntax / missing subject', async () => {
    const t = await ctx.newTenant('Tpl');
    const tpl = await t.template('email', { name: 'welcome', subject: 'Hi {{name}}', body: '<p>{{name}}, your code is {{code}}</p>' });
    assert.equal(tpl.version, 1);
    assert.deepEqual(tpl.placeholders.sort(), ['code', 'name']);
    assert.equal((await ctx.api('POST', '/v1/templates', { key: t.key, body: { name: 'welcome', channel: 'email', subject: 's', body: 'b' } })).status, 409);
    const bad = await ctx.api('POST', '/v1/templates', { key: t.key, body: { name: 'broken', channel: 'sms', body: 'Hello {{name' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'invalid_template_syntax');
    assert.equal((await ctx.api('POST', '/v1/templates', { key: t.key, body: { name: 'nosubject', channel: 'email', body: 'x' } })).status, 400);
    assert.equal((await ctx.api('POST', '/v1/templates', { key: t.key, body: { name: 'badchannel', channel: 'fax', body: 'x' } })).status, 400);
  });

  it('rejects a send with a missing placeholder and does not queue anything', async () => {
    const t = await ctx.newTenant('Missing');
    const tpl = await t.template('email', { subject: 'Hi {{name}}', body: '{{name}} {{code}}' });
    const r = await t.send({ channel: 'email', recipient: 'a@b.test', template_id: tpl.id, payload: { name: 'Asha' } });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'missing_placeholders');
    assert.deepEqual(r.body.error.details.missing, ['code']);
    const list = await ctx.api('GET', '/v1/notifications', { key: t.key });
    assert.equal(list.body.notifications.length, 0);
  });

  it('editing creates a new version and old notifications keep the version they used', async () => {
    const t = await ctx.newTenant('Ver');
    const tpl = await t.template('email', { subject: 'v1 subject {{name}}', body: '<p>v1 {{name}}</p>' });
    const sent = await t.send({ channel: 'email', recipient: 'a@b.test', template_id: tpl.id, payload: { name: 'Asha' } });
    const upd = await ctx.api('PUT', `/v1/templates/${tpl.id}`, { key: t.key, body: { subject: 'v2 subject {{name}}', body: '<p>v2 {{name}}</p>' } });
    assert.equal(upd.status, 200);
    assert.equal(upd.body.version, 2);
    const versions = await ctx.api('GET', `/v1/templates/${tpl.id}/versions`, { key: t.key });
    assert.deepEqual(versions.body.versions.map((v) => v.version), [2, 1]);

    const old = await t.get(sent.body.id);
    assert.equal(old.body.templateVersion, 1);
    assert.match(old.body.body, /v1 Asha/);
    const fresh = await t.send({ channel: 'email', recipient: 'a@b.test', template_id: tpl.id, payload: { name: 'Asha' } });
    assert.equal((await t.get(fresh.body.id)).body.templateVersion, 2);

    const broken = await ctx.api('PUT', `/v1/templates/${tpl.id}`, { key: t.key, body: { body: 'Hello {{name' } });
    assert.equal(broken.status, 400);
    assert.equal((await ctx.api('GET', `/v1/templates/${tpl.id}`, { key: t.key })).body.version, 2, 'rejected edit creates no version');
  });

  it('two simultaneous edits both become separate versions', async () => {
    const t = await ctx.newTenant('Race');
    const tpl = await t.template('sms', { body: 'base {{name}}' });
    const edit = (text) => ctx.api('PUT', `/v1/templates/${tpl.id}`, { key: t.key, body: { body: `${text} {{name}}` } });
    const [a, b] = await Promise.all([edit('first'), edit('second')]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.notEqual(a.body.version, b.body.version);
    const versions = await ctx.api('GET', `/v1/templates/${tpl.id}/versions`, { key: t.key });
    assert.deepEqual(versions.body.versions.map((v) => v.version), [3, 2, 1]);
  });

  it('archived templates cannot be used or edited and disappear from the list, history stays', async () => {
    const t = await ctx.newTenant('Arch');
    const tpl = await t.template('sms', { body: 'Hi {{name}}' });
    const sent = await t.send({ channel: 'sms', recipient: '+8801712345678', template_id: tpl.id, payload: { name: 'A' } });
    assert.equal((await ctx.api('POST', `/v1/templates/${tpl.id}/archive`, { key: t.key })).body.status, 'archived');
    const use = await t.send({ channel: 'sms', recipient: '+8801712345678', template_id: tpl.id, payload: { name: 'A' } });
    assert.equal(use.status, 422);
    assert.equal(use.body.error.code, 'template_archived');
    assert.equal((await ctx.api('PUT', `/v1/templates/${tpl.id}`, { key: t.key, body: { body: 'new {{name}}' } })).status, 409);
    const visible = await ctx.api('GET', '/v1/templates', { key: t.key });
    assert.ok(!visible.body.templates.some((x) => x.id === tpl.id));
    const all = await ctx.api('GET', '/v1/templates?includeArchived=true', { key: t.key });
    assert.ok(all.body.templates.some((x) => x.id === tpl.id));
    assert.equal((await t.get(sent.body.id)).status, 200);
  });
});
