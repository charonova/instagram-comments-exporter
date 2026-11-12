// Starts a throwaway headless Chrome and drives it over the DevTools protocol on a pipe, the only
// transport on which Chrome accepts Extensions.loadUnpacked. Used by the smoke test and by the
// store-image generator.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function launchChrome() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'igce-chrome-'));
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

  for (let tries = 0; ; tries++) {
    try {
      await send('Browser.getVersion');
      break;
    } catch (err) {
      if (tries > 60) throw err;
      await sleep(500);
    }
  }

  /** Opens `url` in a new tab. `before` is script source to run before the page's own scripts. */
  async function openTab(url, { before, viewport } = {}) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    if (viewport) await send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, mobile: false, ...viewport }, sessionId);
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
    const screenshot = async (file, format = 'png') => {
      const { data } = await send('Page.captureScreenshot', format === 'jpeg' ? { format, quality: 92 } : { format }, sessionId);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
    };
    const resize = (size) => send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, mobile: false, ...size }, sessionId);
    return { sessionId, evaluate, until, screenshot, resize };
  }

  async function close() {
    chrome.kill();
    await sleep(500);
    fs.rmSync(work, { recursive: true, force: true });
  }

  return { work, send, openTab, close };
}

/** Wraps `body` so it runs with q/qa bound to the exporter's shadow root in the page. */
export const inSheet = (body) =>
  `(() => { const r = document.querySelector('#igce-root').shadowRoot; const q = (s) => r.querySelector(s); const qa = (s) => [...r.querySelectorAll(s)]; ${body} })()`;
