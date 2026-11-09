import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = resolve(root, 'app');
const dist = resolve(root, 'dist');

for (const required of [resolve(app, 'index.html'), resolve(app, 'app.js'), resolve(app, 'style.css')]) {
  if (!existsSync(required)) throw new Error(`Missing web build input: ${required}`);
}

mkdirSync(dist, { recursive: true });
console.log('Build successful for web distribution.');
