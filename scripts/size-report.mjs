// npm run size — actual unpacked / gzip / ZIP sizes of dist/ and an asset inventory.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { zipSync } from 'fflate';

// Playgama allows up to 300 MB of game files uploaded as an archive.
// https://wiki.playgama.com/playgama/game-requirements/technical-requirements
export const BUDGET_BYTES = 300_000_000;

export function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const CATEGORY = { '.js': 'javascript', '.mjs': 'javascript', '.css': 'css', '.wasm': 'wasm', '.html': 'html', '.json': 'config', '.png': 'images', '.jpg': 'images', '.webp': 'images', '.svg': 'images', '.glb': 'models', '.mp3': 'audio', '.ogg': 'audio', '.wav': 'audio' };

export function sizeReport(distDir = 'dist') {
  const files = walk(distDir).sort();
  const inventory = files.map((f) => {
    const buf = readFileSync(f);
    return { path: relative(distDir, f).split('\\').join('/'), bytes: buf.length, gzip: gzipSync(buf, { level: 9 }).length, category: CATEGORY[extname(f).toLowerCase()] ?? 'other' };
  });
  const unpacked = inventory.reduce((a, f) => a + f.bytes, 0);
  const gzip = inventory.reduce((a, f) => a + f.gzip, 0);
  const zipInput = Object.fromEntries(files.map((f) => [relative(distDir, f).split('\\').join('/'), readFileSync(f)]));
  const zipBytes = zipSync(zipInput, { level: 9 }).length;
  const byCategory = {};
  for (const f of inventory) byCategory[f.category] = (byCategory[f.category] ?? 0) + f.bytes;
  return { unpackedBytes: unpacked, gzipBytes: gzip, zipBytes, budgetBytes: BUDGET_BYTES, withinBudget: unpacked <= BUDGET_BYTES && zipBytes <= BUDGET_BYTES, byCategory, externalTransferBytes: 0, files: inventory };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = sizeReport(process.argv[2] ?? 'dist');
  const kb = (n) => `${(n / 1000).toFixed(1)} kB`;
  console.log(`Unpacked: ${r.unpackedBytes} B (${kb(r.unpackedBytes)})  gzip est.: ${kb(r.gzipBytes)}  ZIP: ${kb(r.zipBytes)}  budget: ${kb(r.budgetBytes)}  ${r.withinBudget ? 'OK' : 'OVER BUDGET'}`);
  for (const [k, v] of Object.entries(r.byCategory)) console.log(`  ${k.padEnd(11)} ${kb(v)}`);
  for (const f of r.files) console.log(`  ${f.path.padEnd(48)} ${kb(f.bytes).padStart(10)}  gz ${kb(f.gzip)}`);
  process.exit(r.withinBudget ? 0 : 1);
}
