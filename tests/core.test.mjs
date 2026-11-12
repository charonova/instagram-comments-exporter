import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContentScript } from './helpers.mjs';

// The page things core.js reads: the address, cookies, bootstrap scripts, fetch and timers.
globalThis.location = { pathname: '/p/DfkYarGBOtk/' };
globalThis.document = { cookie: 'csrftoken=token123; ds_user_id=555', querySelectorAll: () => [] };

const realSetTimeout = globalThis.setTimeout;
let waits = [];
globalThis.setTimeout = (fn, ms, ...args) => {
  waits.push(ms);
  return realSetTimeout(fn, 0, ...args); // pauses and back-offs pass instantly, but are recorded
};

const { core } = loadContentScript('core.js');

const node = (pk, extra = {}) => ({
  pk,
  text: `text ${pk}`,
  created_at: 1794480000,
  comment_like_count: 3,
  child_comment_count: 0,
  user: { username: `user_${pk}`, pk: `9${pk}`, is_verified: false, profile_pic_url: '' },
  ...extra,
});
const connection = (nodes, cursor) => ({ edges: nodes.map((n) => ({ node: n })), page_info: { end_cursor: cursor, has_next_page: Boolean(cursor) } });
const reply = (status, body) => new Response(JSON.stringify(body), { status });

/** A stand-in for Instagram's GraphQL endpoint. `script(name, variables, calls)` returns the Response. */
function fakeInstagram(script) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const form = Object.fromEntries(new URLSearchParams(init.body.toString()));
    const call = { url, name: form.fb_api_req_friendly_name, docId: form.doc_id, variables: JSON.parse(form.variables), headers: init.headers };
    calls.push(call);
    return script(call, calls);
  };
  return calls;
}

test.beforeEach(() => {
  waits = [];
});

test('reads the media ID out of the post address', () => {
  // Checked against the ID Instagram's own page reports for this post.
  assert.deepEqual(core.currentPost(), { code: 'DfkYarGBOtk', mediaId: '4027451352870611812', url: 'https://www.instagram.com/p/DfkYarGBOtk/' });
});

test('logged in: pages through comments, then replies, without duplicates', async () => {
  let slowedDown = false;
  const calls = fakeInstagram(({ name, variables }) => {
    if (name === 'PolarisPostCommentsPaginationQuery') {
      if (variables.first === 50) return reply(200, { errors: [{ message: 'Invalid page size' }] });
      if (variables.after === null) {
        return reply(200, { data: { comments_media: { user: { id: '777', profile_pic_url: '' }, comments_connection: connection([node('1', { child_comment_count: 2, text: 'hi @friend #tag', is_covered: true }), node('2')], 'CURSOR') } } });
      }
      return reply(200, { data: { comments_media: { comments_connection: connection([node('1'), node('3')], null) } } });
    }
    if (!slowedDown) {
      slowedDown = true;
      return reply(429, { message: 'Please wait a few minutes before you try again.' });
    }
    if (variables.after === null) return reply(200, { data: { fetch__XIGComment: { child_comments_connection: connection([node('11')], 'R') } } });
    return reply(200, { data: { fetch__XIGComment: { child_comments_connection: connection([node('12')], null) } } });
  });
  const notices = [];
  const job = await core.loadComments({ loggedIn: true, onNotice: (text) => notices.push(text) });

  assert.equal(job.finished, true);
  assert.equal(job.ownerId, '777', 'the account that posted is read from the response');
  assert.equal(job.viewerId, '555');
  assert.deepEqual(job.comments.map((r) => r.comment_id), ['1', '2', '3'], 'the repeated comment is kept once');
  assert.deepEqual(job.replies.get('1').map((r) => r.comment_id), ['11', '12']);
  assert.equal(job.replyCount, 2);

  const first = job.comments[0];
  assert.equal(first.mentions, 'friend');
  assert.equal(first.hashtags, 'tag');
  assert.equal(first.hidden, true);
  assert.equal(first.created_at_utc, '2026-11-12T10:40:00.000Z');
  assert.equal(first.comment_url, 'https://www.instagram.com/p/DfkYarGBOtk/c/1/');
  const firstReply = job.replies.get('1')[0];
  assert.equal(firstReply.type, 'reply');
  assert.equal(firstReply.parent_comment_id, '1');
  assert.equal(firstReply.comment_url, 'https://www.instagram.com/p/DfkYarGBOtk/c/1/r/11/');

  // Requests: the size falls back to the web app's own after a rejection, and carry the session.
  assert.deepEqual(calls.slice(0, 3).map((c) => [c.variables.first, c.variables.after]), [[50, null], [10, null], [10, 'CURSOR']]);
  assert.equal(calls[1].url, '/api/graphql');
  assert.equal(calls[1].variables.media_id, '4027451352870611812');
  assert.equal(calls[1].variables.sort_order, 'popular');
  assert.equal(calls[1].variables.__relay_internal__pv__PolarisIsLoggedInrelayprovider, true);
  assert.equal(calls[1].headers['X-CSRFToken'], 'token123');
  assert.equal(calls[1].headers['X-IG-App-ID'], '936619743392459');
  const replyCall = calls.find((c) => c.name === 'PolarisPostChildCommentsQuery');
  assert.equal(replyCall.variables.parent_comment_id, '1');

  // The 429 is waited out, announced, and cleared once loading continues.
  assert.ok(waits.includes(60000));
  assert.match(notices[0], /slow down.*Waiting 60s/);
  assert.equal(notices.at(-1), '');
});

test('logged out: uses the public query and skips replies', async () => {
  const calls = fakeInstagram(() => reply(200, { data: { xig_polaris_media: { comments_connection: connection([node('1', { child_comment_count: 4 })], null) } } }));
  const job = await core.loadComments({ loggedIn: false });
  assert.equal(job.comments.length, 1);
  assert.equal(job.replyCount, 0);
  assert.deepEqual(calls.map((c) => c.name), ['PolarisLoggedOutDesktopWWWPostCommentsPaginationQuery']);
  assert.equal('sort_order' in calls[0].variables, false);
});

test('stopping keeps what was loaded', async () => {
  const controller = new AbortController();
  fakeInstagram(({ variables }) => {
    const page = Number(variables.after || 0);
    if (page === 1) controller.abort();
    return reply(200, { data: { m: { comments_connection: connection([node(`p${page}`)], String(page + 1)) } } });
  });
  const job = core.newJob();
  await assert.rejects(core.loadComments({ loggedIn: true, includeReplies: false, job, signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(job.comments.map((r) => r.comment_id), ['p0', 'p1']);
  assert.equal(job.finished, false);
});

test('a refused request reports the login problem and keeps earlier pages', async () => {
  fakeInstagram(({ variables }) => (variables.after ? reply(403, { message: 'forbidden' }) : reply(200, { data: { m: { comments_connection: connection([node('1')], 'NEXT') } } })));
  const job = core.newJob();
  await assert.rejects(core.loadComments({ loggedIn: true, job }), /still logged in/);
  assert.equal(job.comments.length, 1);
});

test('a post without comment data is explained', async () => {
  fakeInstagram(() => reply(200, { data: { xig_polaris_media: null } }));
  await assert.rejects(core.loadComments({ loggedIn: true }), /private, deleted, or have comments turned off/);
});

// ---------- Who follows the account ----------

/** A stand-in for the follower search. `script(query, calls)` returns the response body. */
function fakeFollowerSearch(script) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(url, 'https://www.instagram.com');
    const call = { path: parsed.pathname, query: Object.fromEntries(parsed.searchParams), headers: init.headers };
    calls.push(call);
    return reply(200, script(call.query, calls));
  };
  return calls;
}

function followJob() {
  const person = (id, username) => ({ user_id: id, username, follows_account: '' });
  const job = core.newJob();
  Object.assign(job, { loggedIn: true, viewerId: '555', ownerId: '777' });
  job.comments = [
    { comment_id: 'c1', ...person('1', 'alice') },
    { comment_id: 'c2', ...person('2', 'bob') },
    { comment_id: 'c3', ...person('3', 'cy') },
  ];
  job.replies.set('c2', [{ comment_id: 'r1', ...person('1', 'alice') }]);
  return job;
}
const everyRow = (job) => [...job.comments, ...[...job.replies.values()].flat()];
const strangers = (page) => Array.from({ length: 12 }, (_, i) => ({ pk: `s${page}-${i}`, username: `cy_${page}_${i}` }));

test('follow check: followers, non-followers and inconclusive searches', async () => {
  const calls = fakeFollowerSearch((query) => {
    if (query.query === 'alice') return { users: [{ pk: '900', username: 'alice_fan' }, { pk: '1', username: 'alice' }] };
    if (query.query === 'bob') return { users: [] };
    const page = Number(query.max_id || 0);
    return { users: strangers(page), next_max_id: String(page + 1) }; // always more matches, never cy
  });
  const job = followJob();
  const progress = await core.checkFollowers({ job, rows: everyRow(job) });

  assert.deepEqual(everyRow(job).map((r) => [r.comment_id, r.follows_account]), [['c1', true], ['c2', false], ['c3', null], ['r1', true]]);
  assert.deepEqual({ done: progress.done, total: progress.total, unknown: progress.unknown }, { done: 3, total: 3, unknown: 1 });

  // One search per person, against the account that posted, shaped like the web app's own request.
  assert.deepEqual(calls.map((c) => c.query.query), ['alice', 'bob', 'cy', 'cy', 'cy']);
  assert.equal(calls[0].path, '/api/v1/friendships/777/followers/');
  assert.deepEqual(calls[0].query, { count: '12', query: 'alice', search_surface: 'follow_list_page' });
  assert.equal(calls[3].query.max_id, '1');
  assert.equal(calls[0].headers['X-IG-App-ID'], '936619743392459');
  assert.equal(calls[0].headers['X-CSRFToken'], 'token123');
  assert.equal(calls[0].headers['X-IG-WWW-Claim'], '0');
  assert.ok(waits.every((ms) => ms >= 1500 && ms <= 2500), 'look-ups are spaced out');

  // People already looked up are not asked about again.
  calls.length = 0;
  await core.checkFollowers({ job, rows: everyRow(job) });
  assert.equal(calls.length, 0);
});

test('follow check falls back to the logged-in account when the owner is unknown', async () => {
  const calls = fakeFollowerSearch(() => ({ users: [] }));
  const job = followJob();
  job.ownerId = '';
  await core.checkFollowers({ job, rows: job.comments.slice(0, 1) });
  assert.equal(calls[0].path, '/api/v1/friendships/555/followers/');
});

test('follow check: stopping keeps the answers so far', async () => {
  const controller = new AbortController();
  fakeFollowerSearch((query) => {
    if (query.query === 'bob') controller.abort();
    return { users: [{ pk: '1', username: 'alice' }] };
  });
  const job = followJob();
  await assert.rejects(core.checkFollowers({ job, rows: everyRow(job), signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(everyRow(job).map((r) => r.follows_account), [true, false, '', true]);
});

test('follow check waits when Instagram asks to slow down, and needs a login', async () => {
  let slowed = false;
  globalThis.fetch = async () => {
    if (!slowed) {
      slowed = true;
      return reply(401, { message: 'Please wait a few minutes before you try again.', require_login: true });
    }
    return reply(200, { users: [{ pk: '1', username: 'alice' }] });
  };
  const job = followJob();
  const notices = [];
  await core.checkFollowers({ job, rows: job.comments.slice(0, 1), onNotice: (text) => notices.push(text) });
  assert.equal(job.comments[0].follows_account, true);
  assert.ok(waits.includes(60000));
  assert.match(notices[0], /slow down/);

  job.loggedIn = false;
  await assert.rejects(core.checkFollowers({ job, rows: job.comments }), /Log in to Instagram/);
});

test('logged out, a "please wait" answer is reported as a login problem instead of waited out', async () => {
  const cookies = globalThis.document.cookie;
  globalThis.document.cookie = 'csrftoken=token123'; // nobody logged in
  try {
    globalThis.fetch = async () => reply(401, { message: 'Please wait a few minutes before you try again.', require_login: true, status: 'fail' });
    const job = followJob();
    await assert.rejects(core.checkFollowers({ job, rows: job.comments }), /wants a login/);
    assert.equal(waits.includes(60000), false);
  } finally {
    globalThis.document.cookie = cookies;
  }
});
