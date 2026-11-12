/*
 * Instagram Comments Exporter — the on-page workbench.
 *
 * A launcher button on post pages opens a sheet where the comments are loaded, previewed,
 * narrowed down with a fill-in sentence, and downloaded.
 */
(() => {
  'use strict';
  const ns = (window.__igce = window.__igce || {});
  if (ns.ui || !ns.core || !ns.formats) return;
  const { core, formats } = ns;
  const { COLUMNS, DEFAULT_QUERY, FORMATS } = formats;

  const PREVIEW_ROWS = 200;
  const PREFS_KEY = 'igce:prefs';
  const count = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

  const STYLES = `
    :host { all: initial; position: fixed; right: 20px; bottom: 92px; z-index: 2147483000; color-scheme: light;
      --paper: #fbfcf7; --bar: #e4efe1; --ink: #17211b; --soft: #55655b; --rule: #c3d4c4; --pen: #2340c8; --on-pen: #ffffff;
      --note-bg: #fff5d6; --note-ink: #5c4500; --alarm-bg: #fdecea; --alarm-ink: #a1261b; --shade: rgba(9, 20, 13, 0.55);
      --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      --serif: ui-serif, "New York", "Iowan Old Style", Charter, Georgia, Cambria, serif;
      font: 14px/1.45 var(--sans); color: var(--ink); }
    :host([data-theme="dark"]) { color-scheme: dark;
      --paper: #111a15; --bar: #1a281f; --ink: #e6efe8; --soft: #9fb1a5; --rule: #2e4236; --pen: #a3bbff; --on-pen: #0c1638;
      --note-bg: #3a3112; --note-ink: #f1dc9b; --alarm-bg: #3b1a16; --alarm-ink: #ff9d8f; --shade: rgba(0, 0, 0, 0.65); }
    :host([hidden]) { display: none; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    button, input, select { font: inherit; color: inherit; }
    button { cursor: pointer; }
    button:disabled { cursor: default; opacity: 0.45; }
    :focus-visible { outline: 2px solid var(--pen); outline-offset: 2px; }

    .launcher { display: inline-flex; align-items: center; gap: 8px; border: 0; border-radius: 999px; padding: 10px 18px 10px 14px; font-weight: 600; background: var(--pen); color: var(--on-pen); box-shadow: 0 6px 18px rgba(9, 20, 13, 0.3); font-variant-numeric: tabular-nums; }
    .launcher svg { flex: none; width: 18px; height: 18px; }

    .overlay { position: fixed; inset: 0; display: grid; place-items: center; padding: 24px; background: var(--shade); }
    .sheet { display: flex; flex-direction: column; width: min(1120px, 100%); height: min(840px, 100%); overflow: hidden;
      background: var(--paper); border: 1px solid var(--rule); border-radius: 6px; box-shadow: 0 30px 80px rgba(9, 20, 13, 0.45); }

    .top { display: flex; gap: 16px; align-items: flex-start; justify-content: space-between; padding: 22px 28px 14px; }
    h2 { margin: 0; font: 600 26px/1.2 var(--serif); letter-spacing: -0.01em; overflow-wrap: anywhere; }
    .facts { margin: 6px 0 0; color: var(--soft); font-variant-numeric: tabular-nums; }
    .top-actions { display: flex; gap: 8px; flex: none; }
    .quiet { background: transparent; border: 1px solid var(--rule); border-radius: 4px; padding: 7px 12px; }
    .quiet:hover { border-color: var(--ink); }

    .notices { padding: 0 28px; }
    .notice { margin: 0 0 10px; padding: 9px 12px; border-radius: 4px; background: var(--note-bg); color: var(--note-ink); font-size: 13px; }
    .notice.alarm { background: var(--alarm-bg); color: var(--alarm-ink); }

    .ask { padding: 4px 28px 16px; border-bottom: 1px solid var(--rule); }
    .sentence { position: relative; margin: 0; max-width: 88ch; font: 19px/1.85 var(--serif); }
    .blank { font: inherit; font-style: italic; color: var(--pen); background: transparent; border: 0; border-bottom: 1.5px solid var(--pen);
      border-radius: 0; height: 1.5em; margin: 0 1px; padding: 0 2px; }
    select.blank { appearance: none; -webkit-appearance: none; padding-right: 17px; cursor: pointer; }
    .pick { position: relative; display: inline-block; }
    .pick::after { content: ""; position: absolute; right: 5px; top: 50%; width: 6px; height: 6px; pointer-events: none;
      border-right: 1.5px solid var(--pen); border-bottom: 1.5px solid var(--pen); transform: translateY(-75%) rotate(45deg); }
    input.count { width: 2.6em; text-align: center; }
    input.blank::placeholder { color: var(--pen); opacity: 0.55; }
    .ruler { position: absolute; left: 0; top: 0; visibility: hidden; white-space: pre; font-style: italic; }
    .reset { margin-left: 10px; padding: 0; border: 0; background: none; font: 13px var(--sans); color: var(--soft); text-decoration: underline; }

    .columns { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 14px; }
    .columns-label { margin-right: 4px; font-size: 13px; color: var(--soft); }
    .chip { padding: 3px 10px; border: 1px solid var(--rule); border-radius: 999px; background: var(--bar); font-size: 13px; }
    .chip[aria-pressed="false"] { background: transparent; color: var(--soft); text-decoration: line-through; }
    .follow { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; margin-top: 12px; font-size: 13px; color: var(--soft); font-variant-numeric: tabular-nums; }
    .follow .quiet { padding: 5px 10px; color: var(--ink); }
    .follow.error { color: var(--alarm-ink); }

    .paper { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; }
    .paper.blank-paper { background: repeating-linear-gradient(var(--paper) 0 44px, var(--bar) 44px 88px); }
    .invite { display: grid; justify-items: start; align-content: center; gap: 14px; min-height: 100%; max-width: 62ch; padding: 28px; }
    .invite p { margin: 0; font: 22px/1.35 var(--serif); }
    .invite small { font-size: 13px; color: var(--soft); }
    .check { display: flex; gap: 8px; align-items: center; }

    table { width: 100%; border-collapse: collapse; font-size: 13.5px; font-variant-numeric: tabular-nums; }
    th { position: sticky; top: 0; z-index: 1; padding: 10px 12px; background: var(--paper); border-bottom: 1.5px solid var(--ink); text-align: left; font-weight: 600; white-space: nowrap; }
    td { padding: 9px 12px; vertical-align: top; }
    th:first-child, td:first-child { padding-left: 28px; }
    th:last-child, td:last-child { padding-right: 28px; }
    th.n, td.n { text-align: right; }
    .sort { padding: 0; border: 0; background: none; font-weight: 600; }
    .sort:hover { text-decoration: underline; }
    th[aria-sort="descending"] .sort::after { content: " ↓"; color: var(--pen); }
    th[aria-sort="ascending"] .sort::after { content: " ↑"; color: var(--pen); }
    tbody tr:nth-child(even) td { background: var(--bar); }
    td.dim, td.date { color: var(--soft); white-space: nowrap; }
    td.user { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    td.user a { color: inherit; font-weight: 600; text-decoration: none; }
    td.user a:hover { text-decoration: underline; }
    .verified { color: var(--pen); }
    td.text { min-width: 280px; }
    .clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; overflow-wrap: anywhere; }
    tr.reply .clamp { position: relative; padding-left: 20px; }
    tr.reply .clamp::before { content: "↳"; position: absolute; left: 0; color: var(--soft); }

    .foot { display: flex; flex-wrap: wrap; gap: 12px 16px; align-items: center; padding: 14px 28px; border-top: 1px solid var(--rule); }
    .match { flex: 1; min-width: 220px; margin: 0; color: var(--soft); font-variant-numeric: tabular-nums; }
    .formats { display: flex; overflow: hidden; border: 1px solid var(--ink); border-radius: 4px; }
    .formats button { padding: 8px 14px; border: 0; background: transparent; }
    .formats button + button { border-left: 1px solid var(--ink); }
    .formats button[aria-checked="true"] { background: var(--ink); color: var(--paper); }
    .formats button:focus-visible { outline-offset: -3px; }
    .primary { padding: 9px 18px; border: 0; border-radius: 4px; background: var(--pen); color: var(--on-pen); font-weight: 600; font-variant-numeric: tabular-nums; }

    @media (prefers-reduced-motion: no-preference) {
      .overlay:not([hidden]) .sheet { animation: rise 0.18s ease-out; }
      @keyframes rise { from { opacity: 0; transform: translateY(8px); } }
    }
    /* In a small window the whole sheet scrolls, so the sentence does not squeeze out the preview. */
    @media (max-width: 720px), (max-height: 640px) {
      .sheet { overflow: auto; overscroll-behavior: contain; }
      .paper { flex: none; overflow: visible; }
      .paper.blank-paper { min-height: 320px; }
      th { top: 0; }
      .foot { position: sticky; bottom: 0; background: var(--paper); }
    }
    @media (max-width: 720px) {
      .overlay { padding: 0; }
      .sheet { height: 100%; border: 0; border-radius: 0; }
      .top, .ask, .foot, .invite { padding-left: 16px; padding-right: 16px; }
      .notices { padding: 0 16px; }
      .sentence { font-size: 17px; }
      th:first-child, td:first-child { padding-left: 16px; }
      th:last-child, td:last-child { padding-right: 16px; }
    }
  `;

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key === 'class') node.className = value;
      else if (value === true) node.setAttribute(key, '');
      else if (value !== false && value != null) node.setAttribute(key, value);
    }
    node.append(...children);
    return node;
  }

  function loadPrefs() {
    try {
      return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
    } catch {
      return {};
    }
  }

  const prefs = loadPrefs();
  // Kept as the switched-off columns, so a column added in a later version starts switched on.
  const hiddenColumns = new Set(Array.isArray(prefs.hiddenColumns) ? prefs.hiddenColumns : []);
  const state = {
    job: null,
    controller: null,
    notice: '',
    error: '',
    saved: '',
    rows: [],
    postCode: '',
    query: { ...DEFAULT_QUERY },
    columns: new Set(COLUMNS.map((column) => column.key).filter((key) => !hiddenColumns.has(key))),
    follow: { controller: null, progress: null, error: '' },
    format: FORMATS[prefs.format] ? prefs.format : 'csv',
    includeReplies: prefs.includeReplies !== false,
  };

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ hiddenColumns: COLUMNS.map((column) => column.key).filter((key) => !state.columns.has(key)), format: state.format, includeReplies: state.includeReplies }));
    } catch {
      // Preferences are a convenience; the tool works without them.
    }
  }

  // ---------- Structure ----------

  const host = el('div', { id: 'igce-root' });
  const root = host.attachShadow({ mode: 'open' });
  const sheetStyles = new CSSStyleSheet();
  sheetStyles.replaceSync(STYLES);
  root.adoptedStyleSheets = [sheetStyles];

  // The brand mark (assets/brand/mark.svg), drawn in the current text colour.
  const MARK_PATHS = [
    'M62 24H194A30 30 0 0 1 224 54V66A6 6 0 0 1 218 72H38A6 6 0 0 1 32 66V54A30 30 0 0 1 62 24Z',
    'M38 82H218A6 6 0 0 1 224 88V124A6 6 0 0 1 218 130H38A6 6 0 0 1 32 124V88A6 6 0 0 1 38 82Z',
    'M38 140H218A6 6 0 0 1 224 146V158A30 30 0 0 1 194 188H104L62 230V188A30 30 0 0 1 32 158V146A6 6 0 0 1 38 140Z',
  ];
  function mark() {
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 256 256');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of MARK_PATHS) {
      const path = document.createElementNS(svgNs, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'currentColor');
      svg.append(path);
    }
    return svg;
  }

  const launcherLabel = el('span', {}, 'Export comments');
  const launcher = el('button', { class: 'launcher', type: 'button', onclick: open }, mark(), launcherLabel);

  const title = el('h2', { id: 'igce-title' });
  const facts = el('p', { class: 'facts', role: 'status' });
  const runButton = el('button', { class: 'quiet', type: 'button', onclick: onRunButton });
  const notices = el('div', { class: 'notices' });

  // The query is written as a sentence with blanks, so the file's contents read back in plain words.
  const controls = {};
  const ruler = el('span', { class: 'ruler', 'aria-hidden': 'true' });

  function setQuery(key, value) {
    state.query[key] = value;
    state.saved = '';
    render();
  }

  function pick(key, label, options) {
    const select = el('select', { class: 'blank', 'aria-label': label, onchange: () => { fit(select); setQuery(key, select.value); } },
      ...options.map(([value, text]) => el('option', { value }, text)));
    controls[key] = select;
    return el('span', { class: 'pick' }, select);
  }

  function countBlank(key, label) {
    const input = el('input', { class: 'blank count', type: 'text', inputmode: 'numeric', 'aria-label': label,
      oninput: () => setQuery(key, parseInt(input.value.replace(/\D/g, ''), 10) || 0),
      onblur: () => { input.value = String(state.query[key]); } });
    controls[key] = input;
    return input;
  }

  function textBlank(key, label, placeholder) {
    const input = el('input', { class: 'blank', type: 'text', placeholder, 'aria-label': label, oninput: () => { fit(input); setQuery(key, input.value); } });
    controls[key] = input;
    return input;
  }

  function dateBlank(key, label) {
    const input = el('input', { class: 'blank', type: 'date', 'aria-label': label, onchange: () => setQuery(key, input.value) });
    controls[key] = input;
    return input;
  }

  const resetButton = el('button', { class: 'reset', type: 'button', onclick: () => { state.query = { ...DEFAULT_QUERY }; state.saved = ''; syncControls(); render(); } }, 'Reset');

  const sentence = el('p', { class: 'sentence' },
    'Export ',
    pick('what', 'What to export', [['all', 'comments and replies'], ['comment', 'comments only'], ['reply', 'replies only']]),
    ' ',
    pick('sort', 'Order', [['thread', 'in Instagram’s order'], ['likes', 'most liked first'], ['newest', 'newest first'], ['oldest', 'oldest first'], ['replies', 'most replied to first'], ['username', 'by username, A to Z']]),
    ', with at least ', countBlank('minLikes', 'Minimum likes'), ' likes and ', countBlank('minMentions', 'Minimum mentions'), ' mentions, from ',
    pick('from', 'Who wrote it', [['anyone', 'anyone'], ['verified', 'verified accounts']]),
    ' ',
    pick('follow', 'Whether they follow the account', [['any', 'whether or not they follow the account'], ['yes', 'who follow the account'], ['no', 'who do not follow the account']]),
    ', keeping ',
    pick('each', 'How many per person', [['every', 'every comment'], ['person', 'one per person']]),
    ', ',
    pick('hidden', 'Comments Instagram hides', [['include', 'including'], ['exclude', 'leaving out']]),
    ' the ones Instagram hides. Containing ',
    textBlank('search', 'Text or username to look for', 'any text or @name'),
    ', posted from ', dateBlank('dateFrom', 'Posted from'), ' to ', dateBlank('dateTo', 'Posted until'), '.',
    resetButton,
    ruler,
  );

  const chips = COLUMNS.map((column) =>
    el('button', { class: 'chip', type: 'button', 'data-key': column.key, onclick: () => toggleColumn(column.key) }, column.label));
  const followButton = el('button', { class: 'quiet', type: 'button', onclick: onFollowButton });
  const followStatus = el('span', { role: 'status' });
  const followRow = el('div', { class: 'follow' }, followButton, followStatus);
  const ask = el('section', { class: 'ask', hidden: true, 'aria-label': 'What goes in the file' },
    sentence,
    el('div', { class: 'columns' }, el('span', { class: 'columns-label' }, 'Columns in the file'), ...chips),
    followRow);

  const inviteText = el('p');
  const repliesBox = el('input', { type: 'checkbox', onchange: () => { state.includeReplies = repliesBox.checked; savePrefs(); } });
  const repliesCheck = el('label', { class: 'check' }, repliesBox, 'Include replies');
  const loadButton = el('button', { class: 'primary', type: 'button', onclick: load }, 'Load comments');
  const inviteNote = el('small', {}, 'Long threads take a few minutes. Keep this tab open while it loads.');
  const invite = el('div', { class: 'invite' }, inviteText, repliesCheck, loadButton, inviteNote);

  const tbody = el('tbody');
  // Clicking a heading sorts by it; `sorts` lists the orders it cycles through.
  const HEADINGS = [
    { label: '#', sorts: ['thread'], numeric: true },
    { label: 'User', sorts: ['username'] },
    { label: 'Comment', sorts: [] },
    { label: 'Likes', sorts: ['likes'], numeric: true },
    { label: 'Replies', sorts: ['replies'], numeric: true },
    { label: 'Follows', sorts: [] },
    { label: 'Date', sorts: ['newest', 'oldest'] },
  ];
  const headCells = HEADINGS.map((heading) => {
    const sortBy = () => {
      state.query.sort = heading.sorts[(heading.sorts.indexOf(state.query.sort) + 1) % heading.sorts.length];
      state.saved = '';
      syncControls();
      render();
    };
    const content = heading.sorts.length ? el('button', { class: 'sort', type: 'button', onclick: sortBy }, heading.label) : heading.label;
    return el('th', { class: heading.numeric ? 'n' : null, scope: 'col' }, content);
  });
  const table = el('table', { hidden: true }, el('thead', {}, el('tr', {}, ...headCells)), tbody);
  const paper = el('div', { class: 'paper', tabindex: '0', 'aria-label': 'Preview of the file' }, invite, table);

  const match = el('p', { class: 'match', role: 'status' });
  const formatButtons = Object.entries(FORMATS).map(([key, format]) =>
    el('button', { type: 'button', role: 'radio', 'data-key': key, onclick: () => { state.format = key; state.saved = ''; savePrefs(); render(); } }, format.label));
  const downloadButton = el('button', { class: 'primary', type: 'button', onclick: save });
  const foot = el('footer', { class: 'foot' }, match, el('div', { class: 'formats', role: 'radiogroup', 'aria-label': 'File format' }, ...formatButtons), downloadButton);

  const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'igce-title' },
    el('header', { class: 'top' },
      el('div', {}, title, facts),
      el('div', { class: 'top-actions' }, runButton, el('button', { class: 'quiet', type: 'button', 'aria-label': 'Close', onclick: close }, '✕'))),
    notices, ask, paper, foot);
  const overlay = el('div', { class: 'overlay', hidden: true, onmousedown: (event) => { if (event.target === overlay) close(); } }, sheet);
  root.append(launcher, overlay);

  // ---------- Behaviour ----------

  // Underlined blanks are sized to what they currently say, so the sentence keeps its rhythm.
  function fit(control) {
    const isSelect = control.tagName === 'SELECT';
    ruler.textContent = isSelect ? control.options[control.selectedIndex].text : control.value || control.placeholder;
    control.style.width = `${Math.ceil(ruler.getBoundingClientRect().width) + (isSelect ? 24 : 8)}px`;
  }

  function syncControls() {
    for (const [key, control] of Object.entries(controls)) {
      control.value = String(state.query[key]);
      if (control.type !== 'date' && !control.classList.contains('count')) fit(control);
    }
    repliesBox.checked = state.includeReplies;
  }

  function toggleColumn(key) {
    if (state.columns.has(key)) state.columns.delete(key);
    else state.columns.add(key);
    state.saved = '';
    savePrefs();
    render();
  }

  // Follow Instagram's own appearance, including its manual light/dark switch.
  function applyTheme() {
    const parts = (getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g) || []).map(Number);
    const transparent = parts.length < 3 || (parts.length === 4 && parts[3] === 0);
    const dark = transparent ? matchMedia('(prefers-color-scheme: dark)').matches : 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2] < 128;
    host.dataset.theme = dark ? 'dark' : 'light';
  }

  function open() {
    overlay.hidden = false;
    launcher.hidden = true;
    applyTheme();
    syncPost();
    syncControls();
    render();
    (state.job && state.job.comments.length ? downloadButton : loadButton).focus();
  }

  function close() {
    overlay.hidden = true;
    launcher.hidden = false;
    launcher.focus();
  }

  // What was loaded belongs to one post; start clean when the visitor has moved to another.
  function syncPost() {
    const post = core.currentPost();
    if (!post || post.code === state.postCode || state.controller || state.follow.controller) return;
    state.postCode = post.code;
    state.job = null;
    state.error = '';
    state.saved = '';
    state.follow = { controller: null, progress: null, error: '' };
    state.query = { ...DEFAULT_QUERY };
  }

  let confirmReload = 0;
  function onRunButton() {
    if (state.controller) return state.controller.abort();
    // Loading again throws away minutes of work, so it takes a second click.
    if (!confirmReload) {
      confirmReload = setTimeout(() => { confirmReload = 0; render(); }, 4000);
      return render();
    }
    clearTimeout(confirmReload);
    confirmReload = 0;
    load();
  }

  async function load() {
    if (state.controller) return;
    const controller = (state.controller = new AbortController());
    if (state.follow.controller) state.follow.controller.abort();
    state.follow = { controller: null, progress: null, error: '' };
    const job = (state.job = core.newJob());
    state.error = '';
    state.notice = '';
    state.saved = '';
    render();
    const ticker = setInterval(render, 500); // the preview fills in as pages arrive
    try {
      await core.loadComments({ includeReplies: state.includeReplies, signal: controller.signal, job, onNotice: (text) => { state.notice = text; render(); } });
    } catch (err) {
      if (!err || err.name !== 'AbortError') state.error = (err && err.message) || 'Something went wrong while loading.';
    } finally {
      clearInterval(ticker);
      state.controller = null;
      state.notice = '';
      render();
    }
  }

  // Who the follow check would look up: the people in the current selection, whatever the
  // sentence says about following (otherwise picking "who follow" would leave nobody to check).
  function followCandidates() {
    return state.query.follow === 'any' ? state.rows : formats.select(state.job, { ...state.query, follow: 'any' });
  }

  async function onFollowButton() {
    if (state.follow.controller) return state.follow.controller.abort();
    const controller = new AbortController();
    const progress = {};
    state.follow = { controller, progress, error: '' };
    render();
    const ticker = setInterval(render, 500);
    try {
      await core.checkFollowers({ job: state.job, rows: followCandidates(), signal: controller.signal, progress, onNotice: (text) => { state.notice = text; render(); } });
    } catch (err) {
      if (!err || err.name !== 'AbortError') state.follow.error = (err && err.message) || 'Something went wrong while checking.';
    } finally {
      clearInterval(ticker);
      if (state.follow.controller === controller) state.follow.controller = null;
      state.notice = '';
      render();
    }
  }

  function renderFollow(job, running) {
    const checking = Boolean(state.follow.controller);
    followRow.hidden = !job.loggedIn;
    if (!job.loggedIn) return;
    const tally = { yes: 0, no: 0, unclear: 0, pending: 0 };
    const people = new Set();
    for (const row of followCandidates()) {
      if (!row.user_id || people.has(row.user_id)) continue;
      people.add(row.user_id);
      tally[row.follows_account === true ? 'yes' : row.follows_account === false ? 'no' : row.follows_account === null ? 'unclear' : 'pending']++;
    }
    const otherAccount = Boolean(job.ownerId) && job.ownerId !== job.viewerId;
    const account = !job.ownerId ? 'the account you are logged in with' : otherAccount ? 'the account that posted' : 'your account';
    const results = tally.yes + tally.no + tally.unclear
      ? `${tally.yes.toLocaleString()} follow ${account}, ${tally.no.toLocaleString()} do not${tally.unclear ? `, ${tally.unclear.toLocaleString()} unclear` : ''}.`
      : '';
    followButton.hidden = !checking && !tally.pending;
    followButton.disabled = running;
    followButton.textContent = checking ? 'Stop checking' : results ? `Check ${count(tally.pending, 'more person', 'more people')}` : `Check who follows ${account}`;
    followRow.classList.toggle('error', Boolean(state.follow.error) && !checking);
    if (running) {
      followStatus.textContent = 'Available when loading finishes. Press Stop to check the comments loaded so far.';
    } else if (checking) {
      const { done = 0, total = 0 } = state.follow.progress;
      followStatus.textContent = `Checked ${done.toLocaleString()} of ${count(total, 'person', 'people')}. ${results}`;
    } else if (state.follow.error) {
      followStatus.textContent = `${state.follow.error} ${results}`;
    } else if (tally.pending) {
      const minutes = Math.max(1, Math.round((tally.pending * 2.3) / 60));
      const caveat = otherAccount ? ' Instagram shows only part of another account’s followers, so some may be missed. Log in as that account for a complete answer.' : '';
      followStatus.textContent = `${results} ${count(tally.pending, 'person', 'people')} in this selection to look up, one request each: about ${minutes} min.${caveat}`.trim();
    } else {
      followStatus.textContent = results;
    }
  }

  function save() {
    const keys = COLUMNS.map((column) => column.key).filter((key) => state.columns.has(key));
    state.saved = formats.save(state.job, state.rows, keys, state.format);
    render();
  }

  // ---------- Rendering ----------

  function dateText(iso) {
    return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
  }

  function rowNode(row, index) {
    return el('tr', { class: row.type },
      el('td', { class: 'n dim' }, String(index + 1)),
      el('td', { class: 'user' },
        row.username ? el('a', { href: row.profile_url, target: '_blank', rel: 'noopener' }, '@' + row.username) : 'unknown',
        row.is_verified ? el('span', { class: 'verified', title: 'Verified account' }, ' ✓') : ''),
      el('td', { class: 'text' }, el('div', { class: 'clamp', dir: 'auto' }, row.text || (row.gif_url ? 'GIF' : ''))),
      el('td', { class: 'n' }, row.likes.toLocaleString()),
      el('td', { class: 'n' }, row.type === 'reply' ? '' : row.reply_count.toLocaleString()),
      el('td', {}, row.follows_account === true ? 'Yes' : row.follows_account === false ? 'No' : row.follows_account === null ? 'Unclear' : ''),
      el('td', { class: 'date' }, dateText(row.created_at_utc)));
  }

  function factsText(job, running) {
    if (!job) return 'Nothing loaded yet.';
    const loaded = `${count(job.comments.length, 'comment', 'comments')} and ${count(job.replyCount, 'reply', 'replies')}`;
    if (running) {
      return job.phase === 'replies' ? `Loading replies, thread ${job.thread} of ${job.threads}. ${loaded} so far.` : `Loading comments. ${loaded} so far.`;
    }
    if (!job.finished) return job.comments.length ? `Stopped early with ${loaded} loaded.` : 'Nothing loaded yet.';
    const totals = formats.summarize(job);
    return `${loaded} from ${count(totals.people, 'person', 'people')}, with ${count(totals.likes, 'like', 'likes')} between them.`;
  }

  let drawn = '';
  function render() {
    const post = core.currentPost();
    const job = state.job;
    const running = Boolean(state.controller);
    const hasRows = Boolean(job && job.comments.length);
    const loggedIn = job && job.post ? job.loggedIn : core.isLoggedIn();

    launcherLabel.textContent = running ? `Loading… ${(job.comments.length + job.replyCount).toLocaleString()}` : 'Export comments';
    if (overlay.hidden) return;

    title.textContent = post ? `Comments on ${post.code}` : 'Comments';
    facts.textContent = factsText(job, running);
    runButton.hidden = !job || (!running && !hasRows);
    runButton.textContent = running ? 'Stop' : confirmReload ? 'Discard and load again?' : 'Load again';

    const messages = [];
    if (!loggedIn) messages.push(['', 'You are not logged in, so Instagram only serves part of the comments and no replies. Log in to Instagram and load again for the full list.']);
    if (state.notice) messages.push(['', state.notice]);
    if (state.error) messages.push(['alarm', state.error + (hasRows ? ' What was loaded so far can still be downloaded.' : '')]);
    notices.replaceChildren(...messages.map(([kind, text]) => el('p', { class: `notice ${kind}`, role: kind ? 'alert' : null }, text)));

    ask.hidden = !hasRows;
    table.hidden = !hasRows;
    invite.hidden = hasRows;
    paper.classList.toggle('blank-paper', !hasRows);
    inviteText.textContent = running ? 'Loading the first comments…' : 'Load the comments on this post, then choose what goes in the file.';
    repliesCheck.hidden = running || !loggedIn;
    loadButton.hidden = running;
    inviteNote.hidden = running;
    foot.hidden = !hasRows;
    if (!hasRows) {
      drawn = '';
      return;
    }

    // Rebuilding 200 rows twice a second while loading is wasteful and drops text selection.
    const follow = state.follow;
    const signature = JSON.stringify([job.comments.length, job.replyCount, state.query, [...state.columns], state.format, state.saved, running, Boolean(follow.controller), follow.progress && follow.progress.done, follow.error]);
    if (signature === drawn) return;
    drawn = signature;

    const rows = (state.rows = formats.select(job, state.query));
    const total = job.comments.length + job.replyCount;
    renderFollow(job, running);
    tbody.replaceChildren(...rows.slice(0, PREVIEW_ROWS).map(rowNode));
    for (const control of Object.values(controls)) if (control.tagName === 'SELECT' || control === controls.search) fit(control);
    for (const chip of chips) chip.setAttribute('aria-pressed', String(state.columns.has(chip.dataset.key)));
    for (const button of formatButtons) button.setAttribute('aria-checked', String(button.dataset.key === state.format));
    resetButton.hidden = JSON.stringify(state.query) === JSON.stringify(DEFAULT_QUERY);
    HEADINGS.forEach((heading, i) => {
      const active = heading.sorts.includes(state.query.sort) && state.query.sort !== 'thread';
      if (active) headCells[i].setAttribute('aria-sort', ['oldest', 'username'].includes(state.query.sort) ? 'ascending' : 'descending');
      else headCells[i].removeAttribute('aria-sort');
    });

    const preview = rows.length > PREVIEW_ROWS ? ` The preview shows the first ${PREVIEW_ROWS}.` : '';
    if (state.saved) match.textContent = `Downloaded ${state.saved}.`;
    else if (!state.columns.size) match.textContent = 'Choose at least one column for the file.';
    else if (!rows.length && state.query.follow !== 'any' && !followCandidates().some((row) => typeof row.follows_account === 'boolean')) match.textContent = 'Nobody has been looked up yet. Run the follow check above, then filter by it.';
    else if (!rows.length) match.textContent = `None of the ${count(total, 'row', 'rows')} match. Loosen the sentence above.`;
    else if (rows.length === total) match.textContent = `All ${count(total, 'row', 'rows')} will be in the file.${preview}`;
    else match.textContent = `${rows.length.toLocaleString()} of ${count(total, 'row', 'rows')} match.${preview}`;
    downloadButton.textContent = `Download ${count(rows.length, 'row', 'rows')}`;
    downloadButton.disabled = !rows.length || !state.columns.size;
  }

  // Keep typing inside the sheet from triggering Instagram's own keyboard shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress']) host.addEventListener(type, (event) => event.stopPropagation());
  host.addEventListener('keydown', (event) => {
    if (overlay.hidden) return;
    if (event.key === 'Escape') return close();
    if (event.key !== 'Tab') return;
    const stops = [...sheet.querySelectorAll('button, select, input, a[href], [tabindex]')].filter((node) => !node.disabled && node.offsetParent !== null);
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (event.shiftKey && root.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && root.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  // Instagram is a single-page app, so watch the address instead of relying on page loads.
  function watchPage() {
    const onPost = Boolean(core.currentPost());
    host.hidden = !onPost && overlay.hidden;
    if (!host.isConnected) document.documentElement.append(host);
    if (onPost && !overlay.hidden && !state.controller && core.currentPost().code !== state.postCode) {
      syncPost();
      syncControls();
      render();
    }
  }
  applyTheme();
  watchPage();
  setInterval(watchPage, 800);
  // The blanks are measured in pixels, and the sentence changes size with the window.
  window.addEventListener('resize', () => { if (!overlay.hidden) syncControls(); });

  ns.ui = { open, close, state };
})();
