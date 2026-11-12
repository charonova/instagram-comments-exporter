// End-to-end smoke test against the real thing: starts a throwaway Chrome, loads this folder as an
// unpacked extension, opens a public Instagram post (logged out) and drives the popup and the
// exporter. Needs Google Chrome and a network connection.
//
//   npm run smoke                                   uses the default post below
//   npm run smoke -- https://www.instagram.com/p/<code>/ --shots ./shots
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = process.argv.slice(2);
const POST = args.find((arg) => arg.startsWith('https://')) || 'https://www.instagram.com/p/DfkYarGBOtk/';
const shots = args.includes('--shots') ? path.resolve(args[args.indexOf('--shots') + 1]) : null;

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'igce-smoke-'));
const downloads = path.join(work, 'downloads');
fs.mkdirSync(downloads);
if (shots) fs.mkdirSync(shots, { recursive: true });

// Chrome only accepts Extensions.loadUnpacked over a pipe, so this talks CDP on fd 3 and 4.
const chrome = spawn(
  CHROME,
  ['--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', `--user-data-dir=${path.join(work, 'profile')}`, '--no-first-run', '--no-default-browser-check', '--window-size=1320,900', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
);
let nextId = 0;
let buffer = '';
const pending = new Map();
chrome.stdio[4].on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  for (let end = buffer.indexOf('\0'); end >= 0; end = buffer.indexOf('\0')) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    const waiter = pending.get(message.id);
    if (!waiter) continue;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    pending.set(++nextId, { resolve, reject });
    chrome.stdio[3].write(JSON.stringify({ id: nextId, method, params, sessionId }) + '\0');
  });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openTab(url, before) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  if (before) await send('Page.addScriptToEvaluateOnNewDocument', { source: before }, sessionId);
  await send('Page.navigate', { url }, sessionId);
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async (expression, seconds = 30) => {
    for (let i = 0; i < seconds * 4; i++) {
      if (await evaluate(expression).catch(() => false)) return true;
      await sleep(250);
    }
    return false;
  };
  const shot = async (name) => {
    if (!shots) return;
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync(path.join(shots, name), Buffer.from(data, 'base64'));
  };
  return { sessionId, evaluate, until, shot };
}

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
}

// Runs `body` with q/qa bound to the exporter's shadow root in the page.
const inSheet = (body) => `(() => { const r = document.querySelector('#igce-root').shadowRoot; const q = (s) => r.querySelector(s); const qa = (s) => [...r.querySelectorAll(s)]; ${body} })()`;

try {
  for (let i = 0; ; i++) {
    try {
      await send('Browser.getVersion');
      break;
    } catch (err) {
      if (i > 60) throw err;
      await sleep(500);
    }
  }
  const extension = await send('Extensions.loadUnpacked', { path: root });
  check('Chrome loads the unpacked extension', Boolean(extension.id), extension.id);
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });

  const post = await openTab(POST);
  check('content scripts are injected on the post page', await post.until(`Boolean(window.__igce && window.__igce.core && window.__igce.formats && window.__igce.ui)`));
  check('launcher shows the mark and its label', await post.evaluate(inSheet(`const b = q('.launcher'); return Boolean(b.querySelector('svg')) && b.textContent === 'Export comments';`)));
  await sleep(1500);
  await post.shot('1-launcher.png');

  // The popup, as it looks on a page that is not Instagram.
  const popupUrl = `chrome-extension://${extension.id}/src/popup/popup.html`;
  const elsewhere = await openTab(popupUrl);
  await elsewhere.until(`document.getElementById('message').textContent.length > 0`);
  check('popup elsewhere offers to go to Instagram', (await elsewhere.evaluate(`document.getElementById('action').textContent`)) === 'Go to Instagram');
  await send('Emulation.setDeviceMetricsOverride', { width: 312, height: 150, deviceScaleFactor: 2, mobile: false }, elsewhere.sessionId);
  await elsewhere.shot('2-popup-elsewhere.png');

  // The popup, as if the toolbar button was clicked while the post tab was in front.
  const pretendPostIsActive = `const realQuery = chrome.tabs.query.bind(chrome.tabs); chrome.tabs.query = (info) => realQuery(info.active ? { url: 'https://www.instagram.com/*' } : info);`;
  const popup = await openTab(popupUrl, pretendPostIsActive);
  await popup.until(`!document.getElementById('action').hidden`);
  check('popup on a post offers to open the exporter', (await popup.evaluate(`document.getElementById('action').textContent`)) === 'Open the exporter');
  await send('Emulation.setDeviceMetricsOverride', { width: 312, height: 150, deviceScaleFactor: 2, mobile: false }, popup.sessionId);
  await popup.shot('3-popup-on-post.png');
  await popup.evaluate(`document.getElementById('action').click(); 0`).catch(() => {});
  check('popup button opens the exporter in the post tab', await post.until(inSheet(`return !q('.overlay').hidden;`), 10));

  await post.evaluate(inSheet(`q('.invite .primary').click();`));
  check('comments load from Instagram', await post.until(`window.__igce.ui.state.job && window.__igce.ui.state.job.comments.length >= 20`, 45));
  await post.evaluate(inSheet(`const stop = q('.top-actions .quiet'); if (stop.textContent === 'Stop') stop.click();`));
  await post.until(`!window.__igce.ui.state.controller`, 10);
  const loaded = await post.evaluate(`window.__igce.ui.state.job.comments.length`);
  await post.evaluate(inSheet(`qa('th .sort').find((b) => b.textContent === 'Likes').click();`));
  check('clicking Likes sorts most liked first', await post.evaluate(`window.__igce.ui.state.rows.every((row, i, rows) => !i || rows[i - 1].likes >= row.likes)`), `${loaded} comments`);
  check('the follow check is not offered when logged out', await post.evaluate(inSheet(`return q('.follow').hidden;`)));
  await post.shot('4-exporter.png');

  await post.evaluate(inSheet(`q('.formats [data-key="csv"]').click(); q('.foot .primary').click();`));
  let file = '';
  for (let i = 0; i < 40 && !file; i++) {
    await sleep(250);
    file = fs.readdirSync(downloads).find((name) => name.endsWith('.csv')) || '';
  }
  const csv = file ? fs.readFileSync(path.join(downloads, file), 'utf8') : '';
  check('Download saves a CSV with every loaded row', csv.charCodeAt(0) === 0xfeff && csv.startsWith('username,text,likes', 1) && csv.split('\r\n').length >= loaded, file);
} catch (err) {
  failures++;
  console.log('FAIL', err.message);
} finally {
  chrome.kill();
  await sleep(500);
  fs.rmSync(work, { recursive: true, force: true });
}
console.log(failures ? `${failures} check(s) failed` : 'All checks passed');
process.exit(failures ? 1 : 0);
