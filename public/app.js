'use strict';
/* NotifyHub dashboard. Plain JavaScript, no build step. All user data is inserted with textContent (no innerHTML). */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  function el(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (typeof v === 'boolean') { if (v) node.setAttribute(k, ''); }
      else if (v !== undefined && v !== null) node.setAttribute(k, v);
    }
    for (const kid of kids.flat()) node.append(kid instanceof Node ? kid : document.createTextNode(String(kid ?? '')));
    return node;
  }
  const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };
  const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString() : '');
  const badge = (text) => el('span', { class: `badge ${text}` }, text);

  const state = { token: localStorage.getItem('nh_token'), tenant: null, page: 'dashboard', timers: [], checkoutId: null };

  const starterTemplates = [
    { name: 'CTF Registration Confirmed', subject: 'You’re in: {{event}} CTF', body: 'Hi {{name}},\n\nYour registration for {{event}} is confirmed.\nTeam: {{team}}\nCheck-in: {{checkin}}\n\nBring your laptop, charger, and curiosity. See you at the flags!', channel: 'email' },
    { name: 'Hackathon Club Confirmation', subject: 'Welcome to {{club}} — registration confirmed', body: 'Hi {{name}},\n\nYou’re confirmed for {{event}} with {{club}}.\nTeam: {{team}}\nStart time: {{start_time}}\nVenue: {{venue}}\n\nJoin the participant channel: {{community_url}}', channel: 'email' },
    { name: 'Tech Event Ticket Confirmation', subject: 'Your {{event}} ticket is confirmed · {{ticket_id}}', body: 'Hi {{name}},\n\nYour ticket is confirmed.\nTicket: {{ticket_id}}\nTicket type: {{ticket_type}}\nDate: {{date}}\nVenue: {{venue}}\n\nKeep this email handy at check-in.', channel: 'email' },
    { name: 'Event Reminder · One Day', subject: 'Tomorrow: {{event}} starts at {{start_time}}', body: 'Hi {{name}},\n\nA quick reminder that {{event}} is tomorrow.\nDoors open: {{doors_open}}\nVenue: {{venue}}\nAgenda: {{agenda_url}}\n\nSee you there!', channel: 'email' },
    { name: 'CTF Team Invitation', subject: '{{captain}} invited you to team {{team}}', body: 'Hi {{name}},\n\n{{captain}} invited you to join {{team}} for {{event}}.\nAccept the invitation: {{invite_url}}\n\nInvitation expires {{expires_at}}.', channel: 'email' },
    { name: 'Hackathon Project Submission', subject: 'Submission received: {{project_name}}', body: 'Hi {{name}},\n\nWe received {{project_name}} for {{event}}.\nSubmission ID: {{submission_id}}\nEdit until: {{deadline}}\n\nReview your submission: {{submission_url}}', channel: 'email' },
    { name: 'Speaker Proposal Received', subject: 'We received your talk proposal for {{event}}', body: 'Hi {{name}},\n\nYour talk “{{talk_title}}” is in our review queue.\nProposal ID: {{proposal_id}}\nDecision date: {{decision_date}}\n\nWe’ll email you when the programme is final.', channel: 'email' },
    { name: 'Sponsor Invoice Ready', subject: 'Invoice {{invoice_id}} for {{event}}', body: 'Hello {{name}},\n\nYour sponsorship invoice for {{event}} is ready.\nAmount: {{amount}}\nDue date: {{due_date}}\nInvoice: {{invoice_url}}\n\nReply to this email if you need a purchase order reference.', channel: 'email' },
    { name: 'Account Verification', subject: 'Verify your {{product}} email address', body: 'Hi {{name}},\n\nConfirm your email address to finish setting up {{product}}.\n\nVerify email: {{verify_url}}\n\nThis link expires at {{expires_at}}. If you did not create this account, you can ignore this message.', channel: 'email' },
    { name: 'Password Reset Request', subject: 'Reset your {{product}} password', body: 'Hi {{name}},\n\nA password reset was requested for your account.\n\nChoose a new password: {{reset_url}}\n\nThis secure link expires at {{expires_at}}. If you did not request this, no action is needed.', channel: 'email' },
    { name: 'Security Incident Alert', subject: '[{{severity}}] {{incident_title}}', body: 'Hi {{name}},\n\nA security event needs your attention.\nSeverity: {{severity}}\nAffected service: {{service}}\nDetected: {{detected_at}}\nIncident room: {{incident_url}}\n\nUpdates will be posted in the incident room.', channel: 'email' },
    { name: 'Deployment Complete', subject: '{{service}} {{version}} deployed to {{environment}}', body: 'Hi {{name}},\n\nDeployment completed successfully.\nService: {{service}}\nVersion: {{version}}\nEnvironment: {{environment}}\nCommit: {{commit_sha}}\nDuration: {{duration}}\n\nDashboard: {{dashboard_url}}', channel: 'email' },
    { name: 'Service Maintenance Notice', subject: 'Scheduled maintenance: {{service}} · {{date}}', body: 'Hi {{name}},\n\n{{service}} will be under scheduled maintenance.\nWindow: {{start_time}}–{{end_time}} {{timezone}}\nExpected impact: {{impact}}\nStatus page: {{status_url}}\n\nWe’ll send an update when service is restored.', channel: 'email' },
    { name: 'Weekly Engineering Digest', subject: '{{team}} engineering digest · week of {{week_of}}', body: 'Hi {{name}},\n\nThis week in {{team}}:\nHighlights: {{highlights}}\nShipped: {{shipped}}\nNext week: {{next_week}}\nOpen incidents: {{incidents}}\n\nFull update: {{digest_url}}', channel: 'email' },
    { name: 'Waitlist Opened', subject: 'A place opened for {{event}}!', body: 'Hi {{name}},\n\nA place opened for {{event}} and you are next on the list.\nClaim your spot by {{claim_deadline}}: {{claim_url}}\n\nIf you no longer wish to attend, you can release the place here: {{decline_url}}', channel: 'email' },
  ];

  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(state.token ? { authorization: `Bearer ${state.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    if (res.status === 401 && state.token && !path.startsWith('/api/auth')) { logout(); throw new Error('Your session expired. Please sign in again.'); }
    if (!res.ok) {
      const err = new Error((data && data.error && data.error.message) || `Request failed (${res.status})`);
      err.status = res.status; err.code = data && data.error && data.error.code; err.details = data && data.error && data.error.details;
      throw err;
    }
    return data;
  }

  let toastTimer;
  function toast(message) {
    const t = $('#toast');
    t.textContent = message; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 4000);
  }
  const setMsg = (node, text, ok = false) => { node.textContent = text || ''; node.classList.toggle('ok', ok); };
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };

  /* ---------- auth ---------- */
  function showAuth() { $('#app').classList.add('hidden'); $('#auth').classList.remove('hidden'); stopTimers(); }
  function showApp() { $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden'); }
  function logout() { localStorage.removeItem('nh_token'); state.token = null; state.tenant = null; showAuth(); }

  function authView(view) {
    const forms = { login: '#login-form', register: '#register-form', request: '#reset-request-form', reset: '#reset-complete-form' };
    Object.entries(forms).forEach(([key, selector]) => $(selector).classList.toggle('hidden', key !== view));
    $('#auth-tabs').classList.toggle('hidden', view === 'request' || view === 'reset');
    $$('#auth-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === view));
    setMsg($('#auth-msg'), ''); clear($('#auth-action')).classList.add('hidden');
  }

  $$('#auth-tabs button').forEach((b) => b.addEventListener('click', () => {
    authView(b.dataset.tab);
  }));
  $('#forgot-password').addEventListener('click', () => authView('request'));
  $$('[data-auth-view]').forEach((b) => b.addEventListener('click', () => authView(b.dataset.authView)));

  function authLink(message, url, label) {
    const box = clear($('#auth-action')); box.classList.remove('hidden');
    box.append(el('p', { class: 'small' }, message), el('a', { href: url }, label));
  }
  $('#resend-verification').addEventListener('click', guard(async () => {
    const email = new FormData($('#login-form')).get('email');
    const result = await api('POST', '/api/auth/verification', { email });
    setMsg($('#auth-msg'), result.message, true); clear($('#auth-action')).classList.add('hidden');
    if (result.verificationToken) authLink('Local demo verification link:', `${location.origin}/?verify=${encodeURIComponent(result.verificationToken)}`, 'Verify email');
  }));

  async function login(email, password) {
    const r = await api('POST', '/api/auth/login', { email, password });
    state.token = r.token; state.tenant = r.tenant;
    localStorage.setItem('nh_token', r.token);
    await enterApp();
  }
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await login(f.get('email'), f.get('password')); } catch (err) { setMsg($('#auth-msg'), err.message); }
  });
  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const result = await api('POST', '/api/register', { companyName: f.get('companyName'), email: f.get('email'), password: f.get('password') });
      e.target.reset(); authView('login');
      setMsg($('#auth-msg'), 'Workspace created. Check your email and verify your address before signing in.', true);
      if (result.tenant.verificationToken) authLink('Local demo link (in production, this arrives by email):', `${location.origin}/?verify=${encodeURIComponent(result.tenant.verificationToken)}`, 'Verify email');
    } catch (err) { setMsg($('#auth-msg'), err.message); }
  });
  $('#reset-request-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const email = new FormData(e.target).get('email');
    try {
      const result = await api('POST', '/api/auth/password-reset', { email });
      e.target.reset(); setMsg($('#auth-msg'), result.message, true); clear($('#auth-action')).classList.add('hidden');
      if (result.resetToken) authLink('Local demo link (account existence is hidden in production):', `${location.origin}/?reset=${encodeURIComponent(result.resetToken)}`, 'Choose a new password');
    } catch (err) { setMsg($('#auth-msg'), err.message); }
  });
  $('#reset-complete-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    try {
      await api('POST', '/api/auth/password-reset/complete', { token: f.get('token'), password: f.get('password') });
      e.target.reset(); if (state.token) logout(); authView('login'); setMsg($('#auth-msg'), 'Password updated. Sign in with your new password.', true);
    } catch (err) { setMsg($('#auth-msg'), err.message); }
  });
  async function handleAuthLink() {
    const params = new URLSearchParams(location.search);
    if (params.has('verify')) {
      const token = params.get('verify'); history.replaceState(null, '', '/'); showAuth(); authView('login');
      try { await api('POST', '/api/auth/verify-email', { token }); setMsg($('#auth-msg'), 'Email verified. You can sign in now.', true); }
      catch (err) { setMsg($('#auth-msg'), err.message); }
      return true;
    }
    if (params.has('reset')) {
      const token = params.get('reset'); history.replaceState(null, '', '/'); showAuth(); authView('reset');
      $('#reset-complete-form').elements.token.value = token;
      return true;
    }
    return false;
  }
  $('#logout').addEventListener('click', logout);
  $('#logout-mobile').addEventListener('click', logout);

  async function enterApp() {
    const me = await api('GET', '/api/me');
    state.tenant = me.tenant;
    $('#who').textContent = `${me.tenant.name} (${me.tenant.plan})`;
    $('#mobile-who').textContent = me.tenant.name;
    showApp();
    try { updateModeStatus((await api('GET', '/api/providers/status')).providers); } catch { /* Keep the neutral checking label if provider status is unavailable. */ }
    const params = new URLSearchParams(location.search);
    if (params.get('checkout') && params.get('session')) {
      const id = params.get('session');
      history.replaceState(null, '', '/');
      try {
        if (params.get('checkout') === 'success') { await api('POST', `/api/billing/checkout/${encodeURIComponent(id)}/confirm`); toast('Payment confirmed. You are on the Pro plan.'); }
        else { await api('POST', `/api/billing/checkout/${encodeURIComponent(id)}/cancel`); toast('Checkout cancelled. No charge was made.'); }
      } catch (err) { toast(err.message); }
      return navigate('billing');
    }
    return navigate(state.page);
  }

  /* ---------- navigation ---------- */
  function stopTimers() { state.timers.forEach(clearInterval); state.timers = []; }
  async function navigate(page) {
    state.page = page; stopTimers();
    $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
    $$('.page').forEach((p) => p.classList.toggle('hidden', p.id !== `page-${page}`));
    try { await loaders[page](); } catch (e) { toast(e.message); }
  }
  $$('#nav button').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.page)));
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.go)));
  $('.brand[href="#dashboard"]')?.addEventListener('click', (e) => { e.preventDefault(); navigate('dashboard'); });

  /* ---------- dashboard ---------- */
  const filterForm = $('#filter-form');
  const filterQuery = () => {
    const f = new FormData(filterForm); const q = new URLSearchParams();
    for (const k of ['from', 'to', 'channel', 'status']) if (f.get(k)) q.set(k, f.get(k));
    return q.toString();
  };
  const stat = (label, value, cls) => el('div', { class: `stat ${cls || ''}` }, el('b', {}, value), el('span', {}, label));
  // Widths are set through the CSSOM (element.style.width): inline style="" attributes are blocked by our Content-Security-Policy.
  const sized = (node, pct) => { node.style.width = `${pct}%`; return node; };
  function bar(label, b, max) {
    const pct = (n) => (max ? (n / max) * 100 : 0);
    return el('div', { class: 'bar' },
      el('span', { class: 'label' }, label),
      el('span', { class: 'track' },
        sized(el('span', { class: 'seg-ok' }), pct(b.delivered)),
        sized(el('span', { class: 'seg-bad' }), pct(b.failed)),
        sized(el('span', { class: 'seg-pending' }), pct(b.pending))),
      el('span', { class: 'num' }, `${b.total}`));
  }
  async function loadDashboard() {
    setMsg($('#dash-msg'), '');
    try {
      const s = await api('GET', `/v1/analytics/summary?${filterQuery()}`);
      if (!filterForm.elements.from.value) filterForm.elements.from.value = s.range.from;
      if (!filterForm.elements.to.value) filterForm.elements.to.value = s.range.to;
      clear($('#totals')).append(stat('Total', s.totals.total), stat('Delivered', s.totals.delivered, 'ok'), stat('Failed', s.totals.failed, 'bad'), stat('Pending', s.totals.pending, 'warn'));
      const channels = Object.entries(s.byChannel);
      const maxC = Math.max(1, ...channels.map(([, b]) => b.total));
      clear($('#by-channel')).append(...channels.map(([c, b]) => bar(c, b, maxC)));
      const maxD = Math.max(1, ...s.byDay.map((d) => d.total));
      clear($('#by-day')).append(...(s.byDay.length ? s.byDay.map((d) => bar(d.date.slice(5), d, maxD)) : [el('p', { class: 'muted' }, 'No notifications in this period.')]));
      $('#refreshed').textContent = `Updated ${new Date(s.generatedAt).toLocaleTimeString()} (refreshes every 60 seconds)`;
    } catch (e) { setMsg($('#dash-msg'), e.message); }
  }
  filterForm.addEventListener('submit', (e) => { e.preventDefault(); loadDashboard(); });
  $('#export-csv').addEventListener('click', guard(async () => {
    const res = await fetch(`/v1/analytics/export.csv?${filterQuery()}`, { headers: { authorization: `Bearer ${state.token}` } });
    if (!res.ok) throw new Error((await res.json()).error.message);
    const url = URL.createObjectURL(await res.blob());
    const a = el('a', { href: url, download: 'notifications.csv' }); document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }));

  /* ---------- notifications ---------- */
  let allTemplates = [];
  const templateById = (id) => allTemplates.find((t) => t.id === id);
  const placeholderKeys = (template) => [...new Set(template?.placeholders || [])].sort();
  function showVariableChips(target, placeholders) {
    const box = clear(target);
    if (!placeholders.length) return box.append(el('span', { class: 'variable-empty' }, 'No variables.'));
    for (const key of placeholders) box.append(el('span', { class: 'variable-chip' }, `{{${key}}}`));
  }
  function showVariableInputs(target, placeholders, values = {}, optionalKeys = []) {
    const box = clear(target);
    if (!placeholders.length) return box.append(el('span', { class: 'variable-empty' }, 'This template has no variables.'));
    for (const key of placeholders) {
      const supplied = Object.prototype.hasOwnProperty.call(values, key) || optionalKeys.includes(key);
      box.append(el('label', {}, `{{${key}}}`,
        el('input', { type: 'text', 'data-template-variable': key, 'data-json-value': values[key] ?? '', value: values[key] ?? '', placeholder: supplied ? `Optional override for ${key}` : `Enter ${key}`, required: !supplied })));
    }
  }
  function variableValues(target) {
    return Object.fromEntries($$('[data-template-variable]', target).filter((input) => input.value !== '' && input.value !== input.dataset.jsonValue).map((input) => [input.dataset.templateVariable, input.value]));
  }
  function objectFieldValue(text) { try { const v = JSON.parse(text || '{}'); return v && !Array.isArray(v) && typeof v === 'object' ? v : {}; } catch { return {}; } }
  function updateSingleTemplateVariables() {
    const previous = variableValues($('#send-vars'));
    showVariableInputs($('#send-vars'), placeholderKeys(templateById($('#send-template').value)), { ...objectFieldValue($('#send-form').elements.payload.value), ...previous });
  }
  $('#send-form').elements.payload.addEventListener('input', updateSingleTemplateVariables);
  async function fillTemplateSelect() {
    allTemplates = (await api('GET', '/v1/templates')).templates;
    const channel = $('#send-channel').value;
    const sel = clear($('#send-template'));
    const matching = allTemplates.filter((t) => t.channel === channel);
    if (!matching.length) sel.append(el('option', { value: '' }, `No ${channel} template yet (create one first)`));
    matching.forEach((t) => sel.append(el('option', { value: t.id }, `${t.name} (v${t.version})`)));
    $('#send-recipient').placeholder = { email: 'user@example.com', sms: '+8801712345678', whatsapp: '+8801712345678', telegram: '123456789', webhook: 'https://example.com/hook', 'in-app': 'user-102' }[channel];
    updateSingleTemplateVariables();
  }
  $('#send-channel').addEventListener('change', guard(fillTemplateSelect));
  $('#send-template').addEventListener('change', updateSingleTemplateVariables);
  $('#send-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target); const out = $('#send-result');
    let payload;
    try { payload = JSON.parse(f.get('payload') || '{}'); if (!payload || Array.isArray(payload) || typeof payload !== 'object') throw new Error(); payload = { ...payload, ...variableValues($('#send-vars')) }; } catch { toast('Payload must be a JSON object'); return; }
    try {
      const r = await api('POST', '/v1/notifications', { channel: f.get('channel'), recipient: f.get('recipient'), template_id: f.get('template_id'), payload });
      out.textContent = JSON.stringify(r, null, 2); out.classList.remove('hidden');
      toast('Notification queued'); loadNotifications();
    } catch (err) { out.textContent = JSON.stringify({ error: err.message, details: err.details }, null, 2); out.classList.remove('hidden'); }
  });
  async function loadNotifications() {
    const { notifications } = await api('GET', '/v1/notifications?limit=25');
    const body = clear($('#notes'));
    if (!notifications.length) body.append(el('tr', {}, el('td', { colspan: '6', class: 'muted' }, 'Nothing sent yet.')));
    notifications.forEach((n) => body.append(el('tr', {},
      el('td', {}, fmtTime(n.createdAt)), el('td', {}, n.channel), el('td', {}, n.recipient), el('td', {}, badge(n.status)), el('td', {}, n.attempts),
      el('td', {}, el('button', { class: 'link', onclick: guard(async () => { const d = await api('GET', `/v1/notifications/${n.id}`); const pre = $('#note-detail'); pre.textContent = JSON.stringify(d, null, 2); pre.classList.remove('hidden'); }) }, 'Details')))));
  }
  $('#reload-notes').addEventListener('click', guard(loadNotifications));

  /* ---------- templates ---------- */
  const tplForm = $('#tpl-form');
  function resetTplForm() {
    tplForm.reset(); tplForm.elements.id.value = '';
    tplForm.elements.name.disabled = false; tplForm.elements.channel.disabled = false;
    showVariableChips($('#tpl-vars'), []);
    $('#tpl-submit').textContent = 'Create template'; $('#tpl-cancel').classList.add('hidden');
  }
  tplForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(tplForm); const id = tplForm.elements.id.value;
    try {
      if (id) { await api('PUT', `/v1/templates/${id}`, { subject: f.get('subject') || null, body: f.get('body') }); toast('Saved as a new version'); }
      else { await api('POST', '/v1/templates', { name: f.get('name'), channel: f.get('channel'), subject: f.get('subject') || undefined, body: f.get('body') }); toast('Template created'); }
      resetTplForm(); await loadTemplates();
    } catch (err) { toast(err.message); }
  });
  $('#tpl-cancel').addEventListener('click', resetTplForm);
  const updateEditorVariables = () => {
    const matches = `${tplForm.elements.subject.value}\n${tplForm.elements.body.value}`.match(/{{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*}}/g) || [];
    showVariableChips($('#tpl-vars'), [...new Set(matches.map((match) => match.replace(/[{}\s]/g, '')))].sort());
  };
  tplForm.elements.subject.addEventListener('input', updateEditorVariables);
  tplForm.elements.body.addEventListener('input', updateEditorVariables);
  function editTemplate(t) {
    tplForm.elements.id.value = t.id; tplForm.elements.name.value = t.name; tplForm.elements.channel.value = t.channel;
    tplForm.elements.subject.value = t.subject || ''; tplForm.elements.body.value = t.body;
    tplForm.elements.name.disabled = true; tplForm.elements.channel.disabled = true;
    showVariableChips($('#tpl-vars'), placeholderKeys(t));
    $('#tpl-submit').textContent = `Save as v${t.version + 1}`;
    $('#tpl-cancel').classList.remove('hidden');
    tplForm.scrollIntoView();
  }
  async function archiveTemplate(t) {
    if (!confirm(`Archive "${t.name}"? It can no longer be used for new notifications.`)) return;
    await api('POST', `/v1/templates/${t.id}/archive`);
    await loadTemplates();
  }
  function templateRow(t) {
    const actions = el('td', {});
    if (t.status === 'active') {
      actions.append(
        el('button', { class: 'link', onclick: () => editTemplate(t) }, 'Edit'), ' ',
        el('button', { class: 'link', onclick: guard(() => archiveTemplate(t)) }, 'Archive'),
      );
    }
    return el('tr', {},
      el('td', {}, t.name), el('td', {}, t.channel), el('td', {}, `v${t.version}`),
      el('td', {}, t.placeholders.map((p) => `{{${p}}}`).join(' ')), el('td', {}, badge(t.status)), actions);
  }
  async function loadTemplates() {
    const { templates } = await api('GET', '/v1/templates?includeArchived=true');
    const body = clear($('#tpls'));
    if (!templates.length) body.append(el('tr', {}, el('td', { colspan: '6', class: 'muted' }, 'No templates yet.')));
    for (const t of templates) body.append(templateRow(t));
  }

  $('#starter-templates').addEventListener('click', guard(async () => {
    const button = $('#starter-templates'); button.disabled = true;
    try {
      const existing = new Set((await api('GET', '/v1/templates?includeArchived=true')).templates.map((t) => t.name));
      let added = 0;
      for (const t of starterTemplates) if (!existing.has(t.name)) { await api('POST', '/v1/templates', t); added++; }
      const msg = $('#starter-msg'); msg.textContent = added ? `${added} starter templates added. Choose “Bulk email” to personalize one across a recipient list.` : 'All starter templates are already in this workspace.'; msg.classList.remove('hidden');
      toast(added ? `${added} starter templates added` : 'Starter templates are up to date'); await loadTemplates();
    } finally { button.disabled = false; }
  }));

  /* ---------- bulk email ---------- */
  async function fillBulkTemplateSelect() {
    allTemplates = (await api('GET', '/v1/templates')).templates;
    const sel = clear($('#bulk-template'));
    const emails = allTemplates.filter((t) => t.channel === 'email');
    if (!emails.length) sel.append(el('option', { value: '' }, 'Add starter templates on the Templates page first'));
    emails.forEach((t) => sel.append(el('option', { value: t.id }, `${t.name} (v${t.version})`)));
    updateBulkTemplateVariables();
  }
  function updateBulkTemplateVariables() {
    const previous = variableValues($('#bulk-vars'));
    showVariableInputs($('#bulk-vars'), placeholderKeys(templateById($('#bulk-template').value)), { ...objectFieldValue($('#bulk-form').elements.payload.value), ...previous }, ['name']);
  }
  $('#bulk-form').elements.payload.addEventListener('input', updateBulkTemplateVariables);
  $('#bulk-template').addEventListener('change', updateBulkTemplateVariables);
  $('#bulk-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const out = $('#bulk-result');
    const recipients = String(f.get('recipients') || '').split(/\r?\n/).flatMap((line) => {
      const value = line.trim(); if (!value) return [];
      const parts = value.split(/[\t,]/).map((x) => x.trim()).filter(Boolean);
      if (parts.length === 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parts[0]) && !parts[1].includes('@')) return [{ recipient: parts[0], payload: { name: parts[1] } }];
      return value.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    });
    let payload;
    try { payload = JSON.parse(f.get('payload') || '{}'); if (!payload || Array.isArray(payload) || typeof payload !== 'object') throw new Error(); payload = { ...payload, ...variableValues($('#bulk-vars')) }; }
    catch { setMsg($('#bulk-summary'), 'Shared payload must be a JSON object.'); return; }
    if (!recipients.length) { setMsg($('#bulk-summary'), 'Add at least one email address.'); return; }
    try {
      const result = await api('POST', '/v1/notifications/bulk', { channel: 'email', template_id: f.get('template_id'), recipients, payload });
      out.textContent = JSON.stringify(result, null, 2); out.classList.remove('hidden');
      setMsg($('#bulk-summary'), `${result.accepted} queued · ${result.rejected} rejected`, result.rejected === 0);
      loadNotifications().catch(() => {});
    } catch (err) { out.textContent = JSON.stringify({ error: err.message, details: err.details }, null, 2); out.classList.remove('hidden'); setMsg($('#bulk-summary'), err.message); }
  });

  /* ---------- API keys ---------- */
  $('#key-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('POST', '/api/keys', { name: new FormData(e.target).get('name') || undefined });
      const box = clear($('#new-key')); box.classList.remove('hidden');
      box.append(el('b', {}, 'Copy your new key now. It will not be shown again.'), el('br'), el('code', {}, r.key));
      e.target.reset(); await loadKeys();
    } catch (err) { toast(err.message); }
  });
  async function revokeKey(k) {
    if (!confirm('Revoke this key? Applications using it stop working immediately.')) return;
    await api('DELETE', `/api/keys/${k.id}`);
    await loadKeys();
  }
  function keyRow(k) {
    const action = k.revokedAt
      ? el('span', { class: 'badge failed' }, 'revoked')
      : el('button', { class: 'link danger', onclick: guard(() => revokeKey(k)) }, 'Revoke');
    return el('tr', {},
      el('td', {}, k.name), el('td', {}, el('code', {}, k.prefix)), el('td', {}, fmtTime(k.createdAt)),
      el('td', {}, k.lastUsedAt ? fmtTime(k.lastUsedAt) : 'never'), el('td', {}, action));
  }
  async function loadKeys() {
    const { keys } = await api('GET', '/api/keys');
    const body = clear($('#keys'));
    for (const k of keys) body.append(keyRow(k));
    if (!keys.length) body.append(el('tr', {}, el('td', { colspan: '5', class: 'muted' }, 'No keys yet.')));
  }

  /* ---------- webhooks ---------- */
  $('#hook-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('POST', '/api/webhooks', { url: new FormData(e.target).get('url') }); e.target.reset(); toast('Endpoint added'); await loadWebhooks(); } catch (err) { toast(err.message); }
  });
  async function loadAttempts() {
    const { attempts } = await api('GET', '/api/webhooks/attempts?limit=25');
    const body = clear($('#attempts'));
    if (!attempts.length) body.append(el('tr', {}, el('td', { colspan: '4', class: 'muted' }, 'No deliveries yet.')));
    attempts.forEach((a) => body.append(el('tr', {}, el('td', {}, fmtTime(a.at)), el('td', {}, a.url || ''), el('td', {}, `#${a.attempt}`),
      el('td', {}, badge(a.success ? 'success' : 'failed'), ' ', a.httpStatus ? `HTTP ${a.httpStatus}` : (a.error || '')))));
  }
  async function loadWebhooks() {
    const o = await api('GET', '/api/webhooks');
    $('#hook-secret').textContent = o.signingSecret;
    const body = clear($('#hooks'));
    o.endpoints.forEach((h) => body.append(el('tr', {}, el('td', {}, h.url), el('td', {}, fmtTime(h.createdAt)),
      el('td', {}, el('button', { class: 'link danger', onclick: guard(async () => { await api('DELETE', `/api/webhooks/${h.id}`); await loadWebhooks(); }) }, 'Remove')))));
    if (!o.endpoints.length) body.append(el('tr', {}, el('td', { colspan: '3', class: 'muted' }, 'No endpoints yet.')));
    await loadAttempts();
  }
  $('#reload-attempts').addEventListener('click', guard(loadAttempts));

  /* ---------- billing ---------- */
  async function loadBilling() {
    const b = await api('GET', '/api/billing');
    $('#who').textContent = `${state.tenant.name} (${b.plan})`;
    const card = clear($('#plan-card'));
    const pct = Math.min(100, Math.round((b.used / b.limit) * 100));
    card.append(
      el('h3', {}, `${b.planName} plan`),
      el('p', {}, `${b.used.toLocaleString()} of ${b.limit.toLocaleString()} notifications used in ${b.period} (resets ${b.resetsOn})`),
      el('div', { class: 'meter' }, sized(el('div', {}), pct)),
      b.plan === 'free'
        ? el('button', { class: 'primary', onclick: guard(async () => {
          const c = await api('POST', '/api/billing/checkout');
          if (c.url) { location.href = c.url; return; }
          state.checkoutId = c.sessionId; $('#checkout-card').classList.remove('hidden');
        }) }, `Upgrade to Pro (${b.plans.pro.toLocaleString()} per month)`)
        : el('p', { class: 'muted' }, 'You are on the highest plan.'));
    const body = clear($('#events'));
    b.events.forEach((ev) => body.append(el('tr', {}, el('td', {}, fmtTime(ev.at)), el('td', {}, ev.type), el('td', {}, ev.detail || ''))));
    if (!b.events.length) body.append(el('tr', {}, el('td', { colspan: '3', class: 'muted' }, 'No billing events yet.')));
  }
  $('#pay-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', `/api/billing/checkout/${state.checkoutId}/pay`, { cardNumber: new FormData(e.target).get('cardNumber') });
      $('#checkout-card').classList.add('hidden'); toast('Payment successful. You are on the Pro plan.'); await loadBilling();
    } catch (err) { toast(err.message); await loadBilling(); }
  });
  $('#pay-cancel').addEventListener('click', guard(async () => {
    await api('POST', `/api/billing/checkout/${state.checkoutId}/cancel`); $('#checkout-card').classList.add('hidden'); toast('Checkout cancelled. No charge was made.'); await loadBilling();
  }));

  /* ---------- rate limits ---------- */
  function updateModeStatus(providers) {
    const channels = Object.values(providers);
    const realCount = channels.filter((info) => info.configured && !['simulator', 'simulated'].includes(info.provider)).length;
    const dot = $('#mode-dot');
    dot.classList.toggle('live', realCount === channels.length && channels.length > 0);
    dot.classList.toggle('mixed', realCount > 0 && realCount < channels.length);
    dot.classList.toggle('demo', realCount === 0);
    $('#mode-status').textContent = realCount === channels.length && channels.length > 0
      ? `Real providers configured · ${realCount}/${channels.length}`
      : realCount > 0
        ? `Mixed delivery · ${realCount}/${channels.length} real providers`
        : 'Demo mode · simulated delivery';
  }
  async function loadLimits() {
    const [{ limits }, { providers }] = await Promise.all([api('GET', '/api/rate-limits'), api('GET', '/api/providers/status')]);
    updateModeStatus(providers);
    const status = clear($('#provider-status'));
    for (const [channel, info] of Object.entries(providers)) {
      const stateText = info.configured && info.provider !== 'simulator' && info.provider !== 'simulated' ? 'Credentials configured'
        : (info.provider === 'simulator' || info.provider === 'simulated' ? 'Local simulator' : 'Credentials needed');
      status.append(el('div', { class: `provider-status ${info.configured && !['simulator','simulated'].includes(info.provider) ? 'ready' : 'pending'}` },
        el('strong', {}, channel), el('span', {}, info.provider), el('small', {}, stateText)));
    }
    const body = clear($('#limits'));
    limits.forEach((l) => {
      const input = el('input', { type: 'number', min: '1', max: '100000', value: String(l.perMinute) });
      body.append(el('tr', {}, el('td', {}, l.channel + (l.isDefault ? ' (default)' : '')), el('td', {}, input),
        el('td', {}, el('button', { class: 'primary', onclick: guard(async () => { await api('PUT', '/api/rate-limits', { channel: l.channel, perMinute: Number(input.value) }); toast(`${l.channel} limit saved`); await loadLimits(); }) }, 'Save'))));
    });
  }

  const loaders = {
    dashboard: async () => { await loadDashboard(); state.timers.push(setInterval(loadDashboard, 60000)); },
    notifications: async () => { await fillTemplateSelect(); await loadNotifications(); state.timers.push(setInterval(() => loadNotifications().catch(() => {}), 2500)); },
    bulk: fillBulkTemplateSelect, templates: loadTemplates, keys: loadKeys, webhooks: loadWebhooks, billing: loadBilling, settings: loadLimits,
  };

  /* ---------- start ---------- */
  handleAuthLink().then((handled) => {
    if (handled) return;
    if (state.token) enterApp().catch(() => logout()); else showAuth();
  }).catch((err) => { showAuth(); setMsg($('#auth-msg'), err.message); });
})();
