/*
 * Instagram Comments Exporter — fetching.
 *
 * Runs inside instagram.com (page context) and pages through a post's comments with the same
 * GraphQL operations Instagram's own web app sends, using the session the browser already has.
 */
(() => {
  'use strict';
  const ns = (window.__igce = window.__igce || {});
  if (ns.core) return;

  // Operations as found in Instagram's web bundle on 2026-11-12. Doc IDs change whenever
  // Instagram deploys, so resolveOp() prefers the live value from the page's own module
  // registry and only falls back to the ones written here.
  const OPS = {
    comments: {
      name: 'PolarisPostCommentsPaginationQuery',
      docId: '29250323357962155',
      provided: {
        is_mobile_web: false,
        liked_by_author_badge_enabled: false,
        __relay_internal__pv__PolarisIsMobileWebrelayprovider: false,
        __relay_internal__pv__PolarisLikedByAuthorBadgeEnabledrelayprovider: false,
        __relay_internal__pv__PolarisIsLoggedInrelayprovider: true,
        __relay_internal__pv__PolarisThreadsStyleCommentsEnabledrelayprovider: false,
        __relay_internal__pv__PolarisPinnedCommentsEnabledrelayprovider: false,
      },
    },
    replies: {
      name: 'PolarisPostChildCommentsQuery',
      docId: '29474154138887404',
      provided: {
        __relay_internal__pv__PolarisIsLoggedInrelayprovider: true,
        __relay_internal__pv__PolarisLikedByAuthorBadgeEnabledrelayprovider: false,
        __relay_internal__pv__PolarisThreadsStyleCommentsEnabledrelayprovider: false,
        __relay_internal__pv__PolarisPinnedCommentsEnabledrelayprovider: false,
      },
    },
    // Used only when nobody is logged in. Instagram serves just part of the comments this way.
    loggedOutComments: {
      name: 'PolarisLoggedOutDesktopWWWPostCommentsPaginationQuery',
      docId: '29066632289630283',
      provided: {},
    },
  };

  const APP_ID = '936619743392459';
  const ASBD_ID = '359341';
  // Instagram caps the page size on its side, so asking for 50 returns its maximum. If it
  // rejects the size outright, the second value (what the web app itself sends) is used.
  const COMMENT_PAGE_SIZES = [50, 10];
  const REPLY_PAGE_SIZES = [50, null];
  const DELAY_MS = [700, 1400];
  // Follower look-ups are one request per person, so they are paced more gently.
  const FOLLOW_DELAY_MS = [1500, 2500];
  const FOLLOWER_PAGE_SIZE = 12; // what the web app's follower list asks for
  const FOLLOWER_SEARCH_PAGES = 3;
  const BACKOFF_MS = [60000, 120000, 240000];

  class ExportError extends Error {
    constructor(message, kind) {
      super(message);
      this.kind = kind;
    }
  }

  // ---------- Instagram page internals ----------

  function pageModule(name) {
    try {
      return typeof window.require === 'function' ? window.require(name) : null;
    } catch {
      return null;
    }
  }

  // Meta's modules export either the value itself or { default: value }, depending on the build.
  function withMethod(mod, method) {
    if (mod && typeof mod[method] === 'function') return mod;
    if (mod && mod.default && typeof mod.default[method] === 'function') return mod.default;
    return null;
  }

  function resolveOp(key) {
    const fallback = OPS[key];
    const artifact = pageModule(fallback.name + '.graphql');
    const params = artifact && (artifact.params || (artifact.default && artifact.default.params));
    if (!params || !params.id) return fallback;
    const provided = {};
    for (const [name, mod] of Object.entries(params.providedVariables || {})) {
      const provider = withMethod(mod, 'get');
      try {
        provided[name] = provider.get();
      } catch {
        if (name in fallback.provided) provided[name] = fallback.provided[name];
      }
    }
    return { name: params.name || fallback.name, docId: String(params.id), provided };
  }

  function cookie(name) {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
  }

  // Request parameters the web app attaches to every GraphQL call (CSRF tokens, build info).
  function asyncParams() {
    const mod = pageModule('getAsyncParams');
    const fn = typeof mod === 'function' ? mod : mod && mod.default;
    if (typeof fn === 'function') {
      try {
        const params = fn('POST');
        if (params && typeof params === 'object') return { ...params };
      } catch {
        // fall through to reading the tokens from the page
      }
    }
    const params = { __d: 'www', __a: '1', __comet_req: '7' };
    const html = Array.from(document.querySelectorAll('script[type="application/json"]'), (s) => s.textContent).join('\n');
    const lsd = html.match(/"LSD",\[\],\{"token":"([^"]+)"/);
    const dtsg = html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/);
    if (lsd) params.lsd = lsd[1];
    if (dtsg) params.fb_dtsg = dtsg[1];
    return params;
  }

  // The logged-in account's ID, or '' when nobody is logged in.
  function viewerId() {
    let id = '';
    try {
      id = withMethod(pageModule('CurrentUser'), 'getPossiblyNonFacebookUserID').getPossiblyNonFacebookUserID() || '';
    } catch {
      id = '';
    }
    if (!id || id === '0') id = cookie('ds_user_id');
    return id && id !== '0' ? String(id) : '';
  }

  // What every request to Instagram carries, GraphQL or REST.
  function identity() {
    const userId = viewerId();
    const config = withMethod(pageModule('PolarisConfig'), 'getIGAppID');
    let appId = APP_ID;
    let csrf = cookie('csrftoken');
    try {
      appId = config.getIGAppID() || APP_ID;
      csrf = config.getCSRFToken() || csrf;
    } catch {
      // keep the fallbacks
    }
    const bd = pageModule('BDHeaderConfig');
    return {
      userId,
      loggedIn: Boolean(userId),
      appId: String(appId),
      csrf,
      asbdId: String((bd && bd.ASBD_ID) || ASBD_ID),
    };
  }

  function session() {
    return { ...identity(), params: asyncParams() };
  }

  // A per-session token the web app sends with its REST calls.
  function wwwClaim() {
    try {
      const claim = withMethod(pageModule('PolarisWWWClaim'), 'getWWWClaim').getWWWClaim();
      if (claim) return String(claim);
    } catch {
      // fall through to the storage key the web app uses
    }
    try {
      return sessionStorage.getItem('www-claim-v2') || '0';
    } catch {
      return '0';
    }
  }

  const SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function currentPost() {
    const match = location.pathname.match(/(?:^|\/)(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
    if (!match) return null;
    const code = match[2];
    // Posts from private accounts carry a longer code; the media ID is in its first 11 characters.
    const core = code.length > 20 ? code.slice(0, 11) : code;
    let id = 0n;
    for (const ch of core) id = id * 64n + BigInt(SHORTCODE_ALPHABET.indexOf(ch));
    return { code, mediaId: id.toString(), url: `https://www.instagram.com/p/${code}/` };
  }

  // ---------- Network ----------

  function abortError() {
    return new DOMException('Stopped', 'AbortError');
  }

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(abortError());
      const timer = setTimeout(() => {
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      function onAbort() {
        clearTimeout(timer);
        reject(abortError());
      }
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  const pause = (signal, range = DELAY_MS) => sleep(range[0] + Math.random() * (range[1] - range[0]), signal);

  // One request to Instagram. Returns the parsed JSON, or throws an ExportError saying what went wrong.
  async function call(url, init, signal) {
    let res;
    try {
      res = await fetch(url, { credentials: 'include', ...init, signal });
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      throw new ExportError('Network error while talking to Instagram.', 'rate');
    }
    const text = (await res.text()).replace(/^for \(;;\);/, '');
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      try {
        json = JSON.parse(text.split('\n')[0]);
      } catch {
        json = null;
      }
    }
    const message = (json && (json.message || (json.errors && json.errors[0] && json.errors[0].message))) || '';
    // Logged out, Instagram answers its API with a "please wait" message; waiting would not help.
    if (json && json.require_login && !viewerId()) {
      throw new ExportError('Instagram wants a login for this. Log in to Instagram, then try again.', 'auth');
    }
    if (res.status === 429 || res.status >= 500 || /wait|rate.?limit|temporar|try again/i.test(message)) {
      throw new ExportError(`Instagram is asking to slow down (HTTP ${res.status}).`, 'rate');
    }
    if (res.status === 401 || res.status === 403) {
      throw new ExportError('Instagram refused the request. Check that you are still logged in, then try again.', 'auth');
    }
    if (!json) throw new ExportError(`Instagram sent an unreadable response (HTTP ${res.status}).`, 'http');
    return { json, message };
  }

  async function send(op, variables, signal) {
    const s = session();
    const fields = {
      av: s.userId || '0',
      ...s.params,
      fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: op.name,
      variables: JSON.stringify({ ...variables, ...op.provided }),
      server_timestamps: 'true',
      doc_id: op.docId,
    };
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(fields)) if (value != null) body.append(key, String(value));
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-FB-Friendly-Name': op.name,
      'X-IG-App-ID': s.appId,
      'X-ASBD-ID': s.asbdId,
    };
    if (s.csrf) headers['X-CSRFToken'] = s.csrf;
    if (s.params.lsd) headers['X-FB-LSD'] = String(s.params.lsd);
    const { json, message } = await call('/api/graphql', { method: 'POST', headers, body }, signal);
    if (!json.data) throw new ExportError(message || 'Instagram returned an error for this request.', 'graphql');
    return json.data;
  }

  // A GET on Instagram's REST API, with the headers its web app sends.
  async function getApi(route, query, signal) {
    const s = identity();
    const headers = { 'X-IG-App-ID': s.appId, 'X-ASBD-ID': s.asbdId, 'X-IG-WWW-Claim': wwwClaim() };
    if (s.csrf) headers['X-CSRFToken'] = s.csrf;
    const { json } = await call(`${route}?${new URLSearchParams(query)}`, { headers }, signal);
    return json;
  }

  // Runs `attempt`, waiting and retrying when Instagram asks to slow down.
  async function withBackoff(attempt, ctx) {
    for (let tries = 0; ; tries++) {
      try {
        const result = await attempt();
        if (tries) ctx.onNotice('');
        return result;
      } catch (err) {
        if (err.kind !== 'rate' || tries >= BACKOFF_MS.length) throw err;
        const seconds = BACKOFF_MS[tries] / 1000;
        ctx.onNotice(`${err.message} Waiting ${seconds}s, then continuing.`);
        await sleep(BACKOFF_MS[tries], ctx.signal);
      }
    }
  }

  // The connection sits under a differently named root field per operation, so locate it by shape.
  function findConnection(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 5) return null;
    if (Array.isArray(node.edges) && node.page_info) return node;
    for (const value of Object.values(node)) {
      const hit = findConnection(value, depth + 1);
      if (hit) return hit;
    }
    return null;
  }

  // The comments connection hangs off the post, whose `user` is the account that posted it.
  function findOwnerId(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 4) return '';
    const values = Object.values(node);
    if (values.some((value) => value && Array.isArray(value.edges) && value.page_info)) {
      return node.user ? String(node.user.id || node.user.pk || '') : '';
    }
    for (const value of values) {
      const hit = findOwnerId(value, depth + 1);
      if (hit) return hit;
    }
    return '';
  }

  async function pageThrough(op, makeVariables, sizes, onNodes, ctx) {
    let after = null;
    let size = sizes[0];
    let firstRequest = true;
    const cursors = new Set();
    for (;;) {
      let data;
      try {
        const variables = makeVariables(after, size);
        data = await withBackoff(() => send(op, variables, ctx.signal), ctx);
      } catch (err) {
        if (firstRequest && err.kind === 'graphql' && size !== sizes[1]) {
          size = sizes[1];
          continue;
        }
        throw err;
      }
      firstRequest = false;
      const connection = findConnection(data);
      if (!connection) {
        throw new ExportError('Instagram returned no comment data for this post. It may be private, deleted, or have comments turned off.', 'shape');
      }
      onNodes(connection.edges.map((edge) => edge && edge.node).filter(Boolean), data);
      const next = connection.page_info.has_next_page && connection.page_info.end_cursor;
      if (!next || cursors.has(next)) return;
      cursors.add(next);
      after = next;
      await pause(ctx.signal);
    }
  }

  // ---------- Loading a post's comments ----------

  function toRow(node, post, parentId) {
    const user = node.user || node.fallback_user_info || {};
    const text = node.text || '';
    const gif = node.giphy_media_info && node.giphy_media_info.first_party_cdn_proxied_images;
    const id = String(node.pk);
    const parent = parentId || (node.parent_comment_id ? String(node.parent_comment_id) : '');
    return {
      comment_id: id,
      type: parent ? 'reply' : 'comment',
      parent_comment_id: parent,
      username: user.username || '',
      profile_url: user.username ? `https://www.instagram.com/${user.username}/` : '',
      is_verified: Boolean(user.is_verified),
      text,
      created_at_utc: node.created_at ? new Date(node.created_at * 1000).toISOString() : '',
      likes: node.comment_like_count || 0,
      reply_count: node.child_comment_count || 0,
      mentions: Array.from(text.matchAll(/(?:^|[^\w@])@([A-Za-z0-9._]{1,30})/g), (m) => m[1].replace(/\.+$/, '')).join(' '),
      hashtags: Array.from(text.matchAll(/#([\p{L}\p{N}_]+)/gu), (m) => m[1]).join(' '),
      hidden: Boolean(node.is_covered),
      gif_url: (gif && gif.fixed_height && gif.fixed_height.url) || '',
      comment_url: parent ? `${post.url}c/${parent}/r/${id}/` : `${post.url}c/${id}/`,
      profile_pic_url: user.profile_pic_url || '',
      user_id: String(user.pk || user.id || ''),
      follows_account: '', // '' until checkFollowers looks this person up; then true, false, or null if Instagram's search was inconclusive
    };
  }

  function newJob() {
    return { post: null, loggedIn: false, viewerId: '', ownerId: '', comments: [], replies: new Map(), replyCount: 0, finished: false, phase: '', thread: 0, threads: 0 };
  }

  /**
   * Loads the comments of the post in the address bar into `job`, which is filled as pages
   * arrive so a stopped or failed run still leaves everything loaded so far.
   */
  async function loadComments({ includeReplies = true, signal, onNotice = () => {}, job = newJob(), loggedIn } = {}) {
    const post = currentPost();
    if (!post) throw new ExportError('Open a post or reel first.', 'usage');
    job.post = post;
    job.viewerId = viewerId();
    job.loggedIn = loggedIn === undefined ? Boolean(job.viewerId) : loggedIn;
    const ctx = { signal, onNotice };
    const seen = new Set();

    job.phase = 'comments';
    await pageThrough(
      resolveOp(job.loggedIn ? 'comments' : 'loggedOutComments'),
      (after, first) => (job.loggedIn ? { after, first, media_id: post.mediaId, sort_order: 'popular' } : { after, first, media_id: post.mediaId }),
      COMMENT_PAGE_SIZES,
      (nodes, data) => {
        if (!job.ownerId) job.ownerId = findOwnerId(data);
        for (const node of nodes) {
          if (seen.has(node.pk)) continue;
          seen.add(node.pk);
          job.comments.push(toRow(node, post, ''));
        }
      },
      ctx,
    );

    if (includeReplies && job.loggedIn) {
      const repliesOp = resolveOp('replies');
      const parents = job.comments.filter((row) => row.reply_count > 0);
      job.phase = 'replies';
      job.threads = parents.length;
      for (const [index, parent] of parents.entries()) {
        job.thread = index + 1;
        await pause(signal);
        const rows = [];
        job.replies.set(parent.comment_id, rows);
        await pageThrough(
          repliesOp,
          (after, first) => ({ after, before: null, first, last: null, parent_comment_id: parent.comment_id }),
          REPLY_PAGE_SIZES,
          (nodes) => {
            for (const node of nodes) {
              if (seen.has(node.pk)) continue;
              seen.add(node.pk);
              rows.push(toRow(node, post, parent.comment_id));
              job.replyCount++;
            }
          },
          ctx,
        );
      }
    }
    job.phase = '';
    job.finished = true;
    return job;
  }

  // ---------- Who follows the account ----------

  // Asks Instagram's follower search, the one behind the search box in an account's follower
  // list, whether `person` is among `accountId`'s followers. Returns true, false, or null when
  // the search has more matches than were read and the person was not among them.
  async function isFollower(accountId, person, ctx) {
    let maxId;
    for (let page = 0; page < FOLLOWER_SEARCH_PAGES; page++) {
      const query = { count: FOLLOWER_PAGE_SIZE, query: person.username, search_surface: 'follow_list_page' };
      if (maxId) query.max_id = maxId;
      const result = await withBackoff(() => getApi(`/api/v1/friendships/${accountId}/followers/`, query, ctx.signal), ctx);
      const users = Array.isArray(result.users) ? result.users : [];
      if (users.some((user) => String(user.pk || user.id) === person.user_id || user.username === person.username)) return true;
      maxId = result.next_max_id;
      if (!maxId) return false;
      await pause(ctx.signal, FOLLOW_DELAY_MS);
    }
    return null;
  }

  /**
   * Looks up whether each person in `rows` follows the account that posted, and writes the answer
   * to `follows_account` on every row of theirs in `job`. People already looked up are skipped,
   * so a stopped run can be continued. `progress` is updated as it goes.
   */
  async function checkFollowers({ job, rows, signal, onNotice = () => {}, progress = {} }) {
    const accountId = job.ownerId || job.viewerId;
    if (!job.loggedIn || !accountId) throw new ExportError('Log in to Instagram to check who follows the account.', 'usage');
    const ctx = { signal, onNotice };
    const rowsByPerson = new Map();
    for (const row of [...job.comments, ...[...job.replies.values()].flat()]) {
      if (!rowsByPerson.has(row.user_id)) rowsByPerson.set(row.user_id, []);
      rowsByPerson.get(row.user_id).push(row);
    }
    const people = new Map();
    for (const row of rows) if (row.user_id && row.username && row.follows_account === '') people.set(row.user_id, row);
    Object.assign(progress, { done: 0, total: people.size, unknown: 0 });
    for (const person of people.values()) {
      if (progress.done) await pause(signal, FOLLOW_DELAY_MS);
      const follows = await isFollower(accountId, person, ctx);
      if (follows === null) progress.unknown++;
      for (const row of rowsByPerson.get(person.user_id) || []) row.follows_account = follows;
      progress.done++;
    }
    return progress;
  }

  ns.core = { loadComments, checkFollowers, newJob, currentPost, session, resolveOp, isLoggedIn: () => Boolean(viewerId()) };
})();
