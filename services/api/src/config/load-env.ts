import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// Minimal .env loading for local development; explicit process environment wins.
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const valueLine = line.startsWith('export ') ? line.slice(7) : line;
    const i = valueLine.indexOf('=');
    if (i < 1) continue;
    const name = valueLine.slice(0, i).trim();
    let value = valueLine.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (name && process.env[name] === undefined) process.env[name] = value;
  }
}
