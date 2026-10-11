// Validate and package the upload resources; the game build is packaged separately by release.mjs.
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zipSync } from 'fflate';

const root = 'playgama';
const captures = JSON.parse(await readFile(join(root, 'assets/screenshots/manifest.json'), 'utf8'));
const report = JSON.parse(await readFile(join(root, 'assets/screenshots/capture-report.json'), 'utf8'));
if (report.failures.length) throw new Error('Capture report contains failed cars');
const expectedShots = report.cars.flatMap(car => ['front', 'rear'].map(view => `supercars/${car.id}-${view}.png`));
expectedShots.push('gameplay/city-driving.png', 'gameplay/passenger-gps.png', 'gameplay/garage.png');
for (const file of expectedShots) if (!captures.images.some(image => image.file === file)) throw new Error(`Missing screenshot: ${file}`);
const covers = [
  { file: 'city-ride-square-800x800.png', width: 800, height: 800, role: 'square-cover' },
  { file: 'city-ride-portrait-1080x1920.png', width: 1080, height: 1920, role: 'portrait-cover' },
  { file: 'city-ride-landscape-1920x1080.png', width: 1920, height: 1080, role: 'landscape-cover' },
];
const inventory = [];
for (const image of [
  ...covers.map(image => ({ ...image, file: `covers/${image.file}`, source: 'AI promotional key art based on game references' })),
  ...captures.images.map(image => ({ ...image, file: `screenshots/${image.file}`, role: image.vehicleId ? 'car-screenshot' : 'gameplay-screenshot' })),
]) {
  const bytes = await readFile(join(root, 'assets', image.file));
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`Invalid PNG: ${image.file}`);
  if (bytes.readUInt32BE(16) !== image.width || bytes.readUInt32BE(20) !== image.height) throw new Error(`Wrong dimensions: ${image.file}`);
  if (bytes.length < 75000) throw new Error(`Blank or incomplete image: ${image.file}`);
  inventory.push({ ...image, format: 'PNG', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(join(root, 'assets/manifest.json'), JSON.stringify({ game: 'City Ride', generatedAt: new Date().toISOString(), imageCount: inventory.length, images: inventory }, null, 2) + '\n');

async function walk(relative = '') {
  const files = [];
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) {
      if (path === 'assets/covers/source') continue;
      files.push(...await walk(path));
    } else if (!entry.name.endsWith('.zip') && entry.name !== '.DS_Store') files.push(path);
  }
  return files;
}
const paths = await walk();
// Check local links in all publishing Markdown before shipping the kit.
for (const path of paths.filter(path => path.endsWith('.md'))) {
  const markdown = await readFile(join(root, path), 'utf8');
  for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^(https?:|#)/.test(match[1])) continue;
    const target = join(root, path.slice(0, path.lastIndexOf('/') + 1), match[1]);
    await stat(target).catch(() => { throw new Error(`Broken link in ${path}: ${match[1]}`); });
  }
}
const input = Object.fromEntries(await Promise.all(paths.map(async path => [path, await readFile(join(root, path))])));
const zip = zipSync(input, { level: 6 });
const zipPath = join(root, 'city-ride-publishing-kit.zip');
await writeFile(zipPath, zip);
console.log(`Validated ${inventory.length} images (${covers.length} covers, ${captures.images.length} screenshots), ${report.cars.length} cars.`);
console.log(`Saved ${zipPath} (${(zip.length / 1_000_000).toFixed(1)} MB).`);
