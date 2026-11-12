import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Runs a content script the way the page does: as a classic script sharing one `window`. */
export function loadContentScript(name) {
  globalThis.window = globalThis;
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src/content', name), 'utf8'), { filename: name });
  return globalThis.__igce;
}
