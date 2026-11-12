// End-to-end smoke test against the real thing: starts a throwaway Chrome, loads this folder as an
// unpacked extension, opens a public Instagram post (logged out) and drives the popup and the
// exporter. Needs Google Chrome and a network connection.
//
//   npm run smoke                                   uses the default post below
//   npm run smoke -- https://www.instagram.com/p/<code>/ --shots ./shots
import fs from 'node:fs';
import path from 'node:path';
import { inSheet, launchChrome, sleep } from '../scripts/lib/chrome.mjs';
import { root } from './helpers.mjs';

const args = process.argv.slice(2);
const POST = args.find((arg) => arg.startsWith('https://')) || 'https://www.instagram.com/p/DfkYarGBOtk/';
const shots = args.includes('--shots') ? path.resolve(args[args.indexOf('--shots') + 1]) : null;
if (shots) fs.mkdirSync(shots, { recursive: true });

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
}

const chrome = await launchChrome();
const shot = (tab, name) => (shots ? tab.screenshot(path.join(shots, name)) : null);
const popupSize = { width: 312, height: 150, deviceScaleFactor: 2 };
try {
  const downloads = path.join(chrome.work, 'downloads');
  fs.mkdirSync(downloads);
  const extension = await chrome.send('Extensions.loadUnpacked', { path: root });
  check('Chrome loads the unpacked extension', Boolean(extension.id), extension.id);
  await chrome.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });

  const post = await chrome.openTab(POST);
  check('content scripts are injected on the post page', await post.until(`Boolean(window.__igce && window.__igce.core && window.__igce.formats && window.__igce.ui)`));
  check('launcher shows the mark and its label', await post.evaluate(inSheet(`const b = q('.launcher'); return Boolean(b.querySelector('svg')) && b.textContent === 'Export comments';`)));
  await sleep(1500);
  await shot(post, '1-launcher.png');

  // The popup, as it looks on a page that is not Instagram.
  const popupUrl = `chrome-extension://${extension.id}/src/popup/popup.html`;
  const elsewhere = await chrome.openTab(popupUrl);
  await elsewhere.until(`document.getElementById('message').textContent.length > 0`);
  check('popup elsewhere offers to go to Instagram', (await elsewhere.evaluate(`document.getElementById('action').textContent`)) === 'Go to Instagram');
  await elsewhere.resize(popupSize);
  await shot(elsewhere, '2-popup-elsewhere.png');

  // The popup, as if the toolbar button was clicked while the post tab was in front.
  const pretendPostIsActive = `const realQuery = chrome.tabs.query.bind(chrome.tabs); chrome.tabs.query = (info) => realQuery(info.active ? { url: 'https://www.instagram.com/*' } : info);`;
  const popup = await chrome.openTab(popupUrl, { before: pretendPostIsActive });
  await popup.until(`!document.getElementById('action').hidden`);
  check('popup on a post offers to open the exporter', (await popup.evaluate(`document.getElementById('action').textContent`)) === 'Open the exporter');
  await popup.resize(popupSize);
  await shot(popup, '3-popup-on-post.png');
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
  await shot(post, '4-exporter.png');

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
  await chrome.close();
}
console.log(failures ? `${failures} check(s) failed` : 'All checks passed');
process.exit(failures ? 1 : 0);
