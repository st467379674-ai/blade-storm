import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = path.join(root, '.tmp');
mkdirSync(temp, { recursive: true });

const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const result = spawnSync(process.execPath, [viteBin, 'build'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    TEMP: temp,
    TMP: temp,
  },
});

process.exit(result.status ?? 1);
