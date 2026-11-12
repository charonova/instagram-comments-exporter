import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { root } from './helpers.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const exists = (file) => fs.existsSync(path.join(root, file));

test('manifest fits the Chrome Web Store limits', () => {
  // The store rejects the upload outright when these are exceeded.
  assert.ok(manifest.description.length <= 132, `description is ${manifest.description.length} characters, the limit is 132`);
  assert.ok(manifest.name.length <= 75, `name is ${manifest.name.length} characters, the limit is 75`);
  assert.match(manifest.version, /^\d+(\.\d+){0,3}$/);
  assert.equal(manifest.version, pkg.version, 'manifest.json and package.json carry the same version');
});

test('every file the manifest names is in the project', () => {
  const files = [
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((entry) => entry.js),
  ];
  for (const file of files) assert.ok(exists(file), `${file} is missing`);
  for (const size of ['16', '32', '48', '128']) assert.ok(manifest.icons[size], `no ${size} px icon`);
});
