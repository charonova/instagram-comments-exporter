// Builds dist/instagram-comments-exporter-<version>.zip with only the files Chrome needs,
// ready to upload to the Chrome Web Store or to share.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (manifest.version !== pkg.version) {
  console.error(`Version mismatch: manifest.json has ${manifest.version}, package.json has ${pkg.version}.`);
  process.exit(1);
}

const dist = path.join(root, 'dist');
const zipPath = path.join(dist, `${pkg.name}-${manifest.version}.zip`);
fs.mkdirSync(dist, { recursive: true });
fs.rmSync(zipPath, { force: true });
execFileSync('zip', ['-r', '-X', '-q', zipPath, 'manifest.json', 'src', 'assets/icons', '-x', '*.DS_Store'], { cwd: root, stdio: 'inherit' });
console.log(`${path.relative(root, zipPath)}  ${(fs.statSync(zipPath).size / 1024).toFixed(1)} kB`);
