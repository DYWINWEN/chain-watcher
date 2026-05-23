// Copy non-TS assets (dashboard public, SQL schema) into dist/ after tsc compile.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const ops = [
  ['src/dashboard/public', 'dist/dashboard/public'],
  ['src/storage/schema.sql', 'dist/storage/schema.sql'],
];

for (const [src, dst] of ops) {
  mkdirSync(dirname(join(root, dst)), { recursive: true });
  cpSync(join(root, src), join(root, dst), { recursive: true });
  console.log('copied', src, '→', dst);
}

const migrationsSrc = join(root, 'src/storage/migrations');
if (existsSync(migrationsSrc)) {
  cpSync(migrationsSrc, join(root, 'dist/storage/migrations'), { recursive: true });
  console.log('copied src/storage/migrations → dist/storage/migrations');
}
