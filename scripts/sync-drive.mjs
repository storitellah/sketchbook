#!/usr/bin/env node
// Pulls artwork from the shared Google Drive folder into public/art and
// rewrites public/gallery.json. Run by the GitHub Action on a schedule;
// it only touches files when something in Drive actually changed.
//
// The folder must be shared as "Anyone with the link can view". No API key
// is needed: the public folder view is read directly. Setting GOOGLE_API_KEY
// switches listing to the official Drive API instead.
//
// Photos (JPG, PNG, WebP, HEIC, ...) and PDF scans are both supported;
// every page of a PDF becomes its own sketchbook page (needs `pdftoppm`).

import { readFile, writeFile, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const execFile = promisify(execFileCb);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PUBLIC = path.join(ROOT, 'public');
const MANIFEST = path.join(PUBLIC, 'gallery.json');
const WIDTHS = [640, 1280];
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif|avif|tiff?|bmp)$/i;

const config = JSON.parse(await readFile(path.join(ROOT, 'sketchbook.config.json'), 'utf8'));
const folderInput = process.env.DRIVE_FOLDER || config.driveFolder || '';
const rootId = (folderInput.match(/folders\/([\w-]+)/) || folderInput.match(/[?&]id=([\w-]+)/) || [, folderInput.trim()])[1];
if (!rootId) {
  console.error('Set "driveFolder" in sketchbook.config.json to the shared Drive folder link.');
  process.exit(1);
}
const key = process.env.GOOGLE_API_KEY;

const previous = await readFile(MANIFEST, 'utf8').then(JSON.parse).catch(() => ({ girls: [] }));
const previousArt = new Map(previous.girls.flatMap((g) => g.art || []).map((a) => [a.id, a]));

async function get(url, what) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res;
    if (attempt < 4 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    throw new Error(`${what}: HTTP ${res.status}`);
  }
}

// ---------- listing a folder: [{ id, name, folder }] ----------

const decodeHtml = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

async function listPublic(id) {
  const html = await (await get(`https://drive.google.com/embeddedfolderview?id=${id}`, `folder ${id}`)).text();
  if (!html.includes('flip-entries')) throw new Error(`Folder ${id} isn't readable. Is it shared as "Anyone with the link"?`);
  return html.split('class="flip-entry"').slice(1).map((chunk) => ({
    id: chunk.match(/id="entry-([\w-]+)"/)?.[1],
    name: decodeHtml(chunk.match(/class="flip-entry-title">([^<]*)</)?.[1] || ''),
    folder: /href="[^"]*\/folders\//.test(chunk),
    modified: decodeHtml(chunk.match(/flip-entry-last-modified"><div>([^<]*)</)?.[1] || ''),
  })).filter((f) => f.id);
}

async function listApi(id) {
  const files = [];
  let pageToken = '';
  do {
    const u = new URL('https://www.googleapis.com/drive/v3/files');
    const params = {
      q: `'${id}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime)',
      pageSize: '1000', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', key,
      ...(pageToken && { pageToken }),
    };
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const body = await (await get(u, `folder ${id}`)).json();
    files.push(...body.files.map((f) => ({ id: f.id, name: f.name, modified: f.modifiedTime, folder: f.mimeType === 'application/vnd.google-apps.folder' })));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return files;
}

const list = key ? listApi : listPublic;

// Artwork files in a folder, including any subfolders (e.g. one per year).
// A subfolder named "Hidden" or "Archive" is left out of the book.
async function listArt(id) {
  const out = [];
  for (const f of await list(id)) {
    if (f.folder) { if (!/^(hidden|archive)/i.test(f.name)) out.push(...(await listArt(f.id))); }
    else if (/\.pdf$/i.test(f.name) || IMAGE_EXT.test(f.name)) out.push(f);
  }
  return out;
}

async function download(file) {
  const res = await get(`https://drive.usercontent.google.com/download?id=${file.id}&export=download&confirm=t`, file.name);
  if ((res.headers.get('content-type') || '').includes('text/html')) throw new Error('Drive returned a web page instead of the file');
  return Buffer.from(await res.arrayBuffer());
}

// ---------- turning a file into page images ----------

async function pdfPages(buf) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sketch-'));
  try {
    await writeFile(path.join(dir, 'in.pdf'), buf);
    const info = await execFile('pdfinfo', ['-isodates', path.join(dir, 'in.pdf')]).then((r) => r.stdout, () => '');
    // pdftoppm prints harmless warnings for some phone scans, so check the output instead of the exit code.
    await execFile('pdftoppm', ['-r', '150', '-png', path.join(dir, 'in.pdf'), path.join(dir, 'p')]).catch(() => {});
    const pngs = (await readdir(dir)).filter((f) => f.endsWith('.png')).sort();
    if (!pngs.length) throw new Error('could not render the PDF');
    const pages = await Promise.all(pngs.map((f) => readFile(path.join(dir, f))));
    // Phone scanners often leave the scan date only in an embedded ModDate.
    const raw = buf.toString('latin1').match(/(?:Creation|Mod)Date\s*\(D:(\d{4})(\d\d)(\d\d)/);
    return { pages, date: info.match(/CreationDate:\s+(\d{4}-\d\d-\d\d)/)?.[1] || (raw && `${raw[1]}-${raw[2]}-${raw[3]}`) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function imagePages(file, buf) {
  try {
    const img = sharp(buf, { failOn: 'none' }).rotate();
    const meta = await img.metadata();
    const exif = meta.exif?.toString('latin1').match(/(\d{4}):(\d\d):(\d\d) \d\d:\d\d:\d\d/);
    return { pages: [await img.toBuffer()], date: exif && `${exif[1]}-${exif[2]}-${exif[3]}` };
  } catch (err) {
    // Formats sharp can't decode (e.g. iPhone HEIC): use Drive's own rendition.
    console.warn(`  ${file.name}: ${err.message.split('\n')[0]}; using Drive's preview copy`);
    const res = await get(`https://drive.google.com/thumbnail?id=${file.id}&sz=w1600`, file.name);
    return { pages: [Buffer.from(await res.arrayBuffer())] };
  }
}

// ---------- names, captions and dates ----------

const MONTHS = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
const DATE_RE = /\b(?:(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})|([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})|(\d{4})-(\d\d)-(\d\d))\b/i;

function dateInName(name) {
  const m = name.match(DATE_RE);
  if (!m) return null;
  const pad = (n) => String(n).padStart(2, '0');
  if (m[7]) return `${m[7]}-${m[8]}-${m[9]}`;
  const [d, mon, y] = m[1] ? [m[1], m[2], m[3]] : [m[5], m[4], m[6]];
  const mi = MONTHS.indexOf(mon.slice(0, 3).toLowerCase());
  return mi < 0 ? null : `${y}-${pad(mi + 1)}-${pad(d)}`;
}

// A number at the start of a file name ("01 Rainbow.pdf", "2. Cat.jpg") sets its
// place in the book. Up to three digits, so a date like "2024-03-23 ..." isn't one.
const ORDER_RE = /^\s*(\d{1,3})(?:[\s._)-]+|(?=[a-z]))/i;
const orderOf = (name) => { const m = name.match(ORDER_RE); return m ? +m[1] : null; };
const withoutOrder = (name) => name.replace(ORDER_RE, '');

// A file named "Lara_..." or "Lara ..." belongs in Lara's book whichever folder it's in.
function ownerByName(name, fallback) {
  return config.girls.find((g) => new RegExp(`^${g.name}[\\s_-]`, 'i').test(name)) || fallback;
}

function titleFrom(name, girl) {
  let t = name.replace(/\.[^.]+$/, '')
    .replace(DATE_RE, ' ')
    .replace(/\(\d+\)/g, ' ')
    .replace(/[_]+/g, ' ')
    .replace(/\b(adobe scan|scan|img|pxl|dsc|photo|image)\b/gi, ' ')
    .replace(new RegExp(`\\bby ${girl.name}\\b`, 'i'), ' ')
    .replace(new RegExp(`^\\s*${girl.name}('s)?\\b`, 'i'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/[a-z]{3}/i.test(t) || /^[ivxlc\d\s]+$/i.test(t)) return '';
  return t[0].toUpperCase() + t.slice(1);
}

const exists = (p) => stat(p).then(() => true, () => false);

// ---------- main ----------

const folders = (await list(rootId)).filter((f) => f.folder);
const books = new Map(config.girls.map((g) => [g.slug, []]));
const seen = new Set();
const keep = new Set();
const sources = {}; // Drive file id -> { mod, hash }, so unchanged files aren't downloaded again
const safeDownload = (file) => download(file).catch((err) => console.warn(`  ! skipped ${file.name}: ${err.message}`));
let added = 0;

for (const girl of config.girls) {
  const folder = folders.find((f) => f.name.toLowerCase().includes(girl.name.toLowerCase()));
  if (!folder) console.warn(`No folder named like "${girl.name}" in the Drive folder.`);
  for (const file of folder ? await listArt(folder.id) : []) {
    const owner = ownerByName(withoutOrder(file.name), girl);
    const known = previous.sources?.[file.id];
    let buf = null;
    let hash = file.modified && known?.mod === file.modified ? known.hash : null;
    if (!hash) {
      if (!(buf = await safeDownload(file))) continue;
      hash = createHash('sha1').update(buf).digest('hex');
    }
    sources[file.id] = { mod: file.modified || '', hash };
    if (seen.has(hash)) {
      console.log(`  = ${file.name} is a duplicate, skipped`);
      continue;
    }
    seen.add(hash);
    const tag = hash.slice(0, 10);
    const dir = path.join(PUBLIC, 'art', owner.slug);
    await mkdir(dir, { recursive: true });

    // Reuse earlier work when the file hasn't changed.
    const cached = [];
    for (let p = 1; previousArt.has(`${file.id}-${p}`); p++) cached.push(previousArt.get(`${file.id}-${p}`));
    const fresh = cached.length && cached.every((a) => a.tag === `${tag}-${a.page}` && a.src.startsWith(`art/${owner.slug}/`))
      && (await Promise.all(cached.flatMap((a) => WIDTHS.map((w) => exists(path.join(dir, `${a.tag}-${w}.webp`)))))).every(Boolean);

    let entries = fresh ? cached : null;
    if (!entries) {
      if (!buf && !(buf = await safeDownload(file))) continue;
      try {
        console.log(`  + ${owner.name}: ${file.name}`);
        const { pages, date } = /\.pdf$/i.test(file.name) ? await pdfPages(buf) : await imagePages(file, buf);
        const when = dateInName(file.name) || date || '';
        entries = [];
        for (const [i, page] of pages.entries()) {
          const ptag = `${tag}-${i + 1}`;
          const src = sharp(page).flatten({ background: '#ffffff' });
          const meta = await sharp(page).metadata();
          for (const w of WIDTHS) {
            await src.clone().resize({ width: w, height: w, fit: 'inside', withoutEnlargement: true })
              .webp({ quality: 80, effort: 5 }).toFile(path.join(dir, `${ptag}-${w}.webp`));
          }
          const { dominant: d } = await sharp(page).stats();
          const scale = Math.min(1, WIDTHS.at(-1) / Math.max(meta.width, meta.height));
          entries.push({
            id: `${file.id}-${i + 1}`,
            page: i + 1,
            tag: ptag,
            w: Math.round(meta.width * scale),
            h: Math.round(meta.height * scale),
            color: `rgb(${d.r},${d.g},${d.b})`,
            date: when,
          });
        }
        added++;
      } catch (err) {
        console.warn(`  ! skipped ${file.name}: ${err.message}`);
        continue;
      }
    }
    for (const e of entries) {
      WIDTHS.forEach((w) => keep.add(`${owner.slug}/${e.tag}-${w}.webp`));
      books.get(owner.slug).push({
        ...e,
        title: titleFrom(withoutOrder(file.name), owner),
        name: file.name,
        order: orderOf(file.name),
        src: `art/${owner.slug}/${e.tag}-${WIDTHS.at(-1)}.webp`,
        srcset: WIDTHS.map((w) => `art/${owner.slug}/${e.tag}-${w}.webp ${w}w`).join(', '),
      });
    }
  }
}

const girls = config.girls.map(({ slug, name, cover, accent }) => ({
  slug, name, cover, accent,
  // Numbered files first, in number order; then the rest oldest first, with
  // drawings that have no known date at the end.
  art: books.get(slug).sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity)
    || (a.date || '9').localeCompare(b.date || '9') || a.name.localeCompare(b.name) || a.page - b.page),
}));

// Drop images that were removed from Drive, plus the starter samples.
let removed = 0;
for (const sub of await readdir(path.join(PUBLIC, 'art'))) {
  if (!books.has(sub)) {
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
const next = { title: config.title, girls, sources };
if (strip(next) !== strip(previous)) {
  next.updated = new Date().toISOString();
  await writeFile(MANIFEST, JSON.stringify(next, null, 2) + '\n');
}
console.log(`Done: ${girls.map((g) => `${g.name} ${g.art.length}`).join(', ')} pages (${added} files processed, ${removed / WIDTHS.length} images removed).`);
