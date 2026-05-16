import { cpSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const serverDir = path.join(process.cwd(), '.next', 'server');
const chunksDir = path.join(serverDir, 'chunks');

if (existsSync(chunksDir)) {
  for (const entry of readdirSync(chunksDir)) {
    if (!entry.endsWith('.js')) continue;
    cpSync(path.join(chunksDir, entry), path.join(serverDir, entry));
  }
}
