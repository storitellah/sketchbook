#!/usr/bin/env node
// Pulls artwork from a shared Google Drive folder into public/art and
// rewrites public/gallery.json. Run by the GitHub Action on a schedule;
// it only touches files when something in Drive actually changed.
//
//   GOOGLE_API_KEY   Google Cloud API key with the Drive API enabled
//   DRIVE_FOLDER     the shared folder's link or ID (one subfolder per girl)

import { readFile, writeFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PUBLIC = path.join(ROOT, 'public');
const MANIFEST = path.join(PUBLIC, 'gallery.json');
const WIDTHS = [640, 1280];
const API = 'https://www.googleapis.com/drive/v3';

const key = process.env.GOOGLE_API_KEY;
const folderInput = process.env.DRIVE_FOLDER || '';
if (!key || !folderInput) {
  console.error('Set GOOGLE_API_KEY and DRIVE_FOLDER (link or ID of the shared Drive folder).');
  process.exit(1);
}
const rootId = (folderInput.match(/folders\/([\w-]+)/) || folderInput.match(/[?&]id=([\w-]+)/) || [, folderInput.trim()])[1];

const config = JSON.parse(await readFile(path.join(ROOT, 'sketchbook.config.json'), 'utf8'));
const previous = await readFile(MANIFEST, 'utf8').then(JSON.parse).catch(() => ({ girls: [] }));
const previousArt = new Map(previous.girls.flatMap((g) => g.art || []).map((a) => [a.id, a]));

async function drive(url, params = {}) {
  const u = new URL(url);
  for (const [k, v] of Object.entries({ ...params, key })) u.searchParams.set(k, v);
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(u);
    if (res.ok) return res;
    if (attempt < 4 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    throw new Error(`Drive API ${res.status} for ${u.pathname}: ${await res.text()}`);
  }
}

async function listChildren(id) {
  const files = [];
  let pageToken = '';
  do {
    const res = await drive(`${API}/files`, {
      q: `'${id}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, createdTime, modifiedTime, thumbnailLink, imageMediaMetadata(time))',
      pageSize: '1000',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      ...(pageToken && { pageToken }),
    });
    const body = await res.json();
    files.push(...body.files);
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return files;
}

// Images in a girl's folder, including any subfolders (e.g. one per year).
async function listImages(id) {
  const out = [];
  for (const f of await listChildren(id)) {
    if (f.mimeType === 'application/vnd.google-apps.folder') out.push(...(await listImages(f.id)));
    else if (f.mimeType.startsWith('image/')) out.push(f);
  }
  return out;
}

async function download(file) {
  const res = await drive(`${API}/files/${file.id}`, { alt: 'media', supportsAllDrives: 'true' });
  return Buffer.from(await res.arrayBuffer());
}

// Some formats (e.g. iPhone HEIC) can't be decoded by sharp's bundled libvips;
// Drive's own rendition of the image is a good fallback.
async function decode(file) {
  try {
    const img = sharp(await download(file), { failOn: 'none' }).rotate();
    await img.metadata();
    return await img.toBuffer();
  } catch (err) {
    if (!file.thumbnailLink) throw err;
    console.warn(`  ${file.name}: ${err.message.split('\n')[0]} — using Drive's rendition`);
    const res = await fetch(file.thumbnailLink.replace(/=s\d+$/, '=s1600'));
    if (!res.ok) throw err;
    return sharp(Buffer.from(await res.arrayBuffer())).toBuffer();
  }
}

const exists = (p) => stat(p).then(() => true, () => false);

function titleFrom(name) {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  // Camera-roll names like "IMG 2041" or "PXL 20240101 ..." make poor captions.
  return /^(img|pxl|dsc|photo|image|scan)\b|^\d[\d\s]*$/i.test(base) ? '' : base;
}

function dateOf(file) {
  const exif = file.imageMediaMetadata?.time; // "2024:03:09 15:01:22"
  if (exif && /^\d{4}:\d\d:\d\d/.test(exif)) return exif.slice(0, 10).replaceAll(':', '-');
  return file.createdTime.slice(0, 10);
}

const folders = (await listChildren(rootId)).filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
const girls = [];
const keep = new Set();
let added = 0;

for (const girl of config.girls) {
  const folder = folders.find((f) => f.name.toLowerCase().includes(girl.name.toLowerCase()));
  if (!folder) console.warn(`No folder named like "${girl.name}" in the Drive folder — her book will be empty.`);
  const images = folder ? await listImages(folder.id) : [];
  const dir = path.join(PUBLIC, 'art', girl.slug);
  await mkdir(dir, { recursive: true });

  const art = [];
  for (const file of images) {
    const tag = createHash('sha1').update(file.id + file.modifiedTime).digest('hex').slice(0, 10);
    const names = WIDTHS.map((w) => `${tag}-${w}.webp`);
    names.forEach((n) => keep.add(`${girl.slug}/${n}`));
    const old = previousArt.get(file.id);
    const fresh = old?.tag === tag && (await Promise.all(names.map((n) => exists(path.join(dir, n))))).every(Boolean);

    let entry = fresh ? old : null;
    if (!entry) {
      try {
        console.log(`  + ${girl.name}: ${file.name}`);
        const src = await decode(file);
        const meta = await sharp(src).metadata();
        for (const [i, w] of WIDTHS.entries()) {
          await sharp(src).resize({ width: w, height: w, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 80, effort: 5 }).toFile(path.join(dir, names[i]));
        }
        const { dominant: d } = await sharp(src).stats();
        const scale = Math.min(1, WIDTHS.at(-1) / Math.max(meta.width, meta.height));
        entry = {
          id: file.id,
          tag,
          w: Math.round(meta.width * scale),
          h: Math.round(meta.height * scale),
          color: `rgb(${d.r},${d.g},${d.b})`,
        };
        added++;
      } catch (err) {
        console.warn(`  ! skipped ${file.name}: ${err.message}`);
        continue;
      }
    }
    art.push({
      ...entry,
      title: titleFrom(file.name),
      date: dateOf(file),
      src: `art/${girl.slug}/${names.at(-1)}`,
      srcset: names.map((n, i) => `art/${girl.slug}/${n} ${WIDTHS[i]}w`).join(', '),
    });
  }
  art.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  girls.push({ ...girl, art });
}

// Drop images that were removed from Drive, plus the starter samples.
let removed = 0;
for (const sub of await readdir(path.join(PUBLIC, 'art'))) {
  if (!config.girls.some((g) => g.slug === sub)) {
    await rm(path.join(PUBLIC, 'art', sub), { recursive: true, force: true });
    continue;
  }
  for (const f of await readdir(path.join(PUBLIC, 'art', sub))) {
    if (!keep.has(`${sub}/${f}`)) {
      await rm(path.join(PUBLIC, 'art', sub, f));
      removed++;
    }
  }
}

const strip = (m) => JSON.stringify({ ...m, updated: undefined });
const next = { title: config.title, girls };
if (strip(next) !== strip(previous)) {
  next.updated = new Date().toISOString();
  await writeFile(MANIFEST, JSON.stringify(next, null, 2) + '\n');
}
console.log(`Done: ${girls.map((g) => `${g.name} ${g.art.length}`).join(', ')} (${added} new, ${removed / WIDTHS.length} removed).`);
