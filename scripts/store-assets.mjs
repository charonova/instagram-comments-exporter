// Generates the Chrome Web Store images into store/: screenshots of the exporter driven with
// made-up demo comments (no Instagram traffic, no real people), and the two promo tiles.
//
//   npm run store-assets
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inSheet, launchChrome, sleep } from './lib/chrome.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'store');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// Demo thread: [username, text, likes, replies as [username, text, likes]].
const VERIFIED = ['atlas.coffee'];
const FOLLOWERS = ['amina.designs', 'atlas.coffee', 'sara.codes', 'lina.bakes', 'karim.fit', 'hiba.reads', 'maya.ceramics', 'said.dev'];
const THREAD = [
  ['amina.designs', 'Count me in! @sara.codes @lina.bakes this one is for us 🎉', 214, [['sara.codes', 'Yes!! Entering too 🙌', 12], ['lina.bakes', 'Thanks for the tag 💛', 8]]],
  ['atlas.coffee', 'Good luck everyone ☕ We are adding a bag of beans to the prize.', 187, [['youssef_k', 'Best news of the day', 21]]],
  ['youssef_k', 'Done ✅ Following and shared to my story @karim.fit @nour.photo', 96, []],
  ['lina.bakes', 'مشاركة 🙌 @hiba.reads @said.dev بالتوفيق للجميع', 143, [['hiba.reads', 'شكرا على الإشارة ❤️', 6]]],
  ['omar_travels', 'Je participe ! @maya.ceramics @rayan_films', 61, []],
  ['sara.codes', 'Where can I buy it if I do not win? 😅', 38, [['atlas.coffee', 'It is in our shop from Friday.', 15]]],
  ['hiba.reads', 'Is this open worldwide?', 54, [['atlas.coffee', 'Yes, we ship everywhere.', 19]]],
  ['maya.ceramics', 'Fingers crossed 🤞 @lina.bakes @omar_travels @sara.codes', 73, []],
  ['karim.fit', 'Love the colours on this one 😍', 22, []],
  ['nour.photo', '@amina.designs look at this!!', 17, []],
  ['said.dev', 'Following since day one 💙 @youssef_k', 12, []],
  ['rayan_films', '🔥🔥🔥', 9, []],
  ['amina.designs', 'Second entry for my sister @maya.ceramics', 31, []],
  ['youssef_k', 'When do you announce the winner?', 14, [['atlas.coffee', 'Sunday evening, right here.', 11]]],
  ['omar_travels', 'Shared ✈️ @said.dev @karim.fit', 27, []],
  ['karim.fit', 'Entered! @rayan_films @nour.photo', 19, []],
  ['lina.bakes', 'This would look perfect in my kitchen', 44, []],
  ['nour.photo', 'The packaging alone 👏', 25, []],
];

// Runs in the page: answers the exporter's requests from the demo thread instead of Instagram.
function installDemo(thread, verified, followers) {
  const realTimeout = window.setTimeout;
  window.setTimeout = (fn, ms, ...rest) => realTimeout(fn, ms >= 600 && ms !== 4000 ? 15 : ms, ...rest);
  const people = [...new Set(thread.flatMap(([name, , , replies]) => [name, ...replies.map((reply) => reply[0])]))];
  const user = (name) => ({ username: name, pk: String(4000 + people.indexOf(name)), is_verified: verified.includes(name), profile_pic_url: '' });
  let minute = 0;
  const comment = (pk, [name, text, likes, replies = []]) => ({ pk, text, created_at: 1794300000 + 1740 * minute++, comment_like_count: likes, child_comment_count: replies.length, user: user(name) });
  const top = thread.map((entry, i) => comment(`c${i}`, entry));
  const connection = (nodes, cursor) => ({ edges: nodes.map((node) => ({ node })), page_info: { end_cursor: cursor, has_next_page: Boolean(cursor) } });
  const reply = (body) => new Response(JSON.stringify(body), { status: 200 });
  window.fetch = async (url, init) => {
    if (String(url).startsWith('/api/v1/friendships/')) {
      const name = new URL(url, 'https://www.instagram.com').searchParams.get('query');
      return reply({ users: followers.includes(name) ? [user(name)] : [] });
    }
    const form = new URLSearchParams(init.body.toString());
    const variables = JSON.parse(form.get('variables'));
    if (form.get('fb_api_req_friendly_name') === 'PolarisPostChildCommentsQuery') {
      const index = Number(variables.parent_comment_id.slice(1));
      return reply({ data: { fetch__XIGComment: { child_comments_connection: connection(thread[index][3].map((entry, i) => comment(`r${index}_${i}`, entry)), null) } } });
    }
    const page = Number(variables.after || 0);
    return reply({ data: { comments_media: { user: { id: '777' }, comments_connection: connection(top.slice(page * 9, page * 9 + 9), page < 1 ? String(page + 1) : null) } } });
  };
  const load = window.__igce.core.loadComments;
  window.__igce.core.isLoggedIn = () => true;
  window.__igce.core.loadComments = async (options) => {
    const job = await load({ ...options, loggedIn: true });
    job.viewerId = job.ownerId; // the demo is the page owner looking at its own post
    return job;
  };
}

const PROMO = `<!doctype html><meta charset="utf-8"><style>
  html, body { height: 100%; margin: 0; }
  body { display: flex; align-items: center; justify-content: center; gap: 7vh; background: repeating-linear-gradient(#fbfcf7 0 12.5vh, #e4efe1 12.5vh 25vh);
    color: #17211b; font-family: ui-serif, "New York", "Iowan Old Style", Charter, Georgia, serif; }
  svg { height: 44vh; width: 44vh; flex: none; filter: drop-shadow(0 2vh 3vh rgba(9, 20, 13, 0.22)); }
  h1 { margin: 0; font-size: 15vh; line-height: 1.08; font-weight: 600; letter-spacing: -0.01em; }
  p { margin: 2.2vh 0 0; font-size: 8.2vh; color: #2340c8; font-style: italic; }
</style>${read('assets/brand/icon.svg')}<div><h1>Comments<br>Exporter</h1><p>for Instagram</p></div>`;

const chrome = await launchChrome();
try {
  fs.mkdirSync(path.join(out, 'screenshots'), { recursive: true });

  // A stand-in post page; the address has the /p/<code>/ shape the exporter looks for.
  const page = path.join(chrome.work, 'p', 'CxDemoPost1');
  fs.mkdirSync(page, { recursive: true });
  fs.writeFileSync(path.join(page, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Demo post</title><style>body { margin: 0; background: #eef1ee; }</style>');
  const tab = await chrome.openTab(`file://${page}/index.html`, { viewport: { width: 1280, height: 800 } });
  await sleep(500);
  for (const file of ['core.js', 'formats.js', 'ui.js']) await tab.evaluate(`${read(`src/content/${file}`)}\n;0`);
  await tab.evaluate(`(${installDemo})(${JSON.stringify(THREAD)}, ${JSON.stringify(VERIFIED)}, ${JSON.stringify(FOLLOWERS)})`);

  const ui = (body) => tab.evaluate(inSheet(body));
  const choose = (label, value, event = 'change') => ui(`const n = q('[aria-label="${label}"]'); n.value = ${JSON.stringify(value)}; n.dispatchEvent(new Event('${event}', { bubbles: true }));`);
  const shot = async (name) => {
    await sleep(400);
    await tab.screenshot(path.join(out, 'screenshots', name), 'jpeg');
    console.log(`store/screenshots/${name}`);
  };

  await ui(`q('.launcher').click(); q('.invite .primary').click();`);
  await tab.until(`window.__igce.ui.state.job && window.__igce.ui.state.job.finished`);
  await ui(`q('.formats [data-key="csv"]').click();`);
  await shot('1-preview.jpg');

  await choose('Order', 'likes');
  await choose('How many per person', 'person');
  await ui(`qa('.chip').filter((chip) => ['Profile picture', 'GIF', 'Comment ID', 'User ID', 'Parent comment ID'].includes(chip.textContent)).forEach((chip) => chip.click()); q('.formats [data-key="xlsx"]').click();`);
  await shot('2-sort-and-filter.jpg');

  await ui(`q('.follow .quiet').click();`);
  await tab.until(`!window.__igce.ui.state.follow.controller`);
  await choose('Whether they follow the account', 'yes');
  await shot('3-follow-check.jpg');

  await tab.evaluate(`document.body.style.background = '#0c110d'; 0`);
  await ui(`q('.reset').click(); q('.top-actions .quiet:last-child').click(); q('.launcher').click();`);
  await choose('Minimum mentions', '2', 'input');
  await choose('Order', 'newest');
  await shot('4-dark.jpg');

  const promo = path.join(chrome.work, 'promo.html');
  fs.writeFileSync(promo, PROMO);
  for (const [name, width, height] of [['promo-small-440x280.jpg', 440, 280], ['promo-marquee-1400x560.jpg', 1400, 560]]) {
    const tile = await chrome.openTab(`file://${promo}`, { viewport: { width, height } });
    await sleep(600);
    await tile.screenshot(path.join(out, name), 'jpeg');
    console.log(`store/${name}`);
  }
} finally {
  await chrome.close();
}
