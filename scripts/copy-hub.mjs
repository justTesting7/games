import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../index.html', import.meta.url));
const dest = fileURLToPath(new URL('../dist/index.html', import.meta.url));
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log('hub →', dest);
