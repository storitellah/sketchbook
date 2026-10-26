// Luna & Lara's sketchbook: a small flip-book with no dependencies.
// Artwork comes from gallery.json, which the Drive sync keeps up to date.

const $ = (sel) => document.querySelector(sel);
const book = $('#book');
const stage = $('#stage');
const tabsEl = $('.tabs');
const prevBtn = $('#prev');
const nextBtn = $('#next');
const counter = $('#counter');
const viewer = $('#viewer');

const PAGE_RATIO = 3 / 4; // page width / height

let data;
let girl;
let pages = [];   // flat list of page descriptions, cover first
let leaves = [];  // DOM leaves; each leaf has a front and a back face
let current = 0;  // how many leaves have been turned
let single = false;
let pageW = 300;
let raise = 1000;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function formatDate(iso) {
  const d = new Date(iso + 'T12:00:00');
  return isNaN(d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

// ---------- building the book ----------

function buildPages() {
  const art = girl.art || [];
  pages = [{ type: 'cover' }];
  art.forEach((a, i) => pages.push({ type: 'art', art: a, n: i + 1 }));
  if (!art.length) pages.push({ type: 'blank', text: `${esc(girl.name)}'s first drawings are on their way!` });
  // In a two-page spread the back cover must land on the back of the last leaf.
  if (!single && pages.length % 2 === 1) pages.push({ type: 'blank', text: '' });
  pages.push({ type: 'end' });
}

function pageHTML(p, i) {
  if (!p) return '<div class="page"></div>';
  if (p.type === 'cover') {
    const count = girl.art?.length || 0;
    return `<div class="page cover"><div class="label">
      <h2>${esc(girl.name)}'s</h2><p>Sketchbook</p>
      <p>${count ? `${count} drawing${count === 1 ? '' : 's'}` : 'coming soon'}</p></div></div>`;
  }
  if (p.type === 'end') {
    return `<div class="page cover"><div class="label"><h2>The End</h2><p>…for now! More drawings soon.</p></div></div>`;
  }
  if (p.type === 'blank') {
    return `<div class="page"><p class="blank">${p.text}</p></div>`;
  }
  const a = p.art;
  const rot = ((i * 37) % 5) - 2; // a gentle, stable tilt per drawing
  const caption = a.title ? esc(a.title) : '';
  const date = a.date ? `<span class="date">${formatDate(a.date)}</span>` : '';
  return `<div class="page">
    <div class="frame" style="--rot:${rot * 0.6}deg">
      <span class="tape" style="top:-6px;left:12%;transform:rotate(${-8 + rot}deg)"></span>
      <span class="tape" style="bottom:-6px;right:12%;transform:rotate(${6 - rot}deg)"></span>
      <img data-src="${esc(a.src)}" data-srcset="${esc(a.srcset || '')}" width="${a.w}" height="${a.h}"
        style="--ph:${esc(a.color || '#eee5d5')}" alt="${caption || `Drawing ${p.n} by ${esc(girl.name)}`}" decoding="async" draggable="false">
    </div>
    <p class="caption">${caption}${date}</p>
    <button class="zoom" type="button" data-page="${i}" aria-label="View larger">&#x2922;</button>
    <span class="folio">${p.n}</span>
  </div>`;
}

function build(startPage = 0) {
  buildPages();
  const faces = [];
  if (single) pages.forEach((p, i) => faces.push([i, null]));
  else for (let i = 0; i < pages.length; i += 2) faces.push([i, i + 1]);

  book.classList.add('instant');
  book.classList.toggle('single', single);
  book.innerHTML = faces.map(([f, b]) => `<div class="leaf">
      <div class="face front">${pageHTML(pages[f], f)}</div>
      <div class="face back">${b == null ? pageHTML(null) : pageHTML(pages[b], b)}</div>
    </div>`).join('');
  leaves = [...book.children];
  current = Math.min(single ? startPage : Math.ceil(startPage / 2), maxTurn());
  update();
  requestAnimationFrame(() => requestAnimationFrame(() => book.classList.remove('instant')));
}

// On phones the last page can't be turned (there's nothing to see behind it).
const maxTurn = () => (single ? leaves.length - 1 : leaves.length);

// The page index the reader is looking at (right-hand page in a spread).
function visiblePage() {
  if (single) return current;
  return current >= leaves.length ? pages.length - 1 : current * 2;
}

// ---------- state ----------

function update(changed = []) {
  const n = leaves.length;
  leaves.forEach((leaf, k) => {
    const flipped = k < current;
    leaf.classList.toggle('flipped', flipped);
    if (changed.includes(k)) {
      leaf.style.zIndex = ++raise;
      setTimeout(() => { if (leaf.style.zIndex == raise) settle(); }, 900);
    } else if (!leaf.style.zIndex || leaf.style.zIndex < 1000) {
      leaf.style.zIndex = flipped ? k + 1 : n - k;
    }
  });

  let shift = 0;
  if (!single && current === 0) shift = -pageW / 2;
  if (!single && current === n) shift = pageW / 2;
  book.style.setProperty('--shift', `${shift}px`);

  prevBtn.disabled = current === 0;
  nextBtn.disabled = current >= maxTurn();
  const p = visiblePage();
  const total = girl.art?.length || 0;
  const pageOf = (i) => pages[i]?.type === 'art' ? pages[i].n : null;
  const shown = [single ? null : pageOf(p - 1), pageOf(p)].filter(Boolean);
  counter.textContent = current === 0 ? 'Cover'
    : shown.length ? `${shown.join('–')} / ${total}`
    : pages[p]?.type === 'end' ? 'The End' : '';

  loadNear();
  const hash = `#${girl.slug}${p ? `/${p}` : ''}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

// Once a turn has finished, put every leaf back in its natural stacking order.
function settle() {
  const n = leaves.length;
  leaves.forEach((leaf, k) => { leaf.style.zIndex = k < current ? k + 1 : n - k; });
}

function go(delta) {
  const target = Math.max(0, Math.min(maxTurn(), current + delta));
  if (target === current) return;
  const changed = [];
  for (let k = Math.min(current, target); k < Math.max(current, target); k++) changed.push(k);
  current = target;
  update(changed);
}

function goTo(turn) { go(turn - current); }

// Only download drawings on or near the open pages.
function loadNear() {
  const lo = Math.max(0, current - 2);
  const hi = Math.min(leaves.length - 1, current + 2);
  for (let k = lo; k <= hi; k++) {
    for (const img of leaves[k].querySelectorAll('img[data-src]')) {
      img.sizes = `${Math.round(pageW)}px`;
      if (img.dataset.srcset) img.srcset = img.dataset.srcset;
      img.src = img.dataset.src;
      img.removeAttribute('data-src');
      if (img.complete) img.classList.add('loaded');
      else img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
    }
  }
}

// ---------- layout ----------

function layout() {
  const w = stage.clientWidth - 32;
  const h = stage.clientHeight - 12;
  const wantSingle = w < 700 || w < h * 1.05;
  pageW = Math.floor(Math.max(160, Math.min(wantSingle ? w - 16 : w / 2 - 8, h * PAGE_RATIO)));
  document.documentElement.style.setProperty('--page-w', `${pageW}px`);
  document.documentElement.style.setProperty('--page-h', `${Math.floor(pageW / PAGE_RATIO)}px`);
  if (wantSingle !== single && girl) {
    const p = visiblePage();
    single = wantSingle;
    build(p);
  } else {
    single = wantSingle;
    if (girl) update();
  }
}

// ---------- tabs ----------

function selectGirl(slug, startPage = 0) {
  girl = data.girls.find((g) => g.slug === slug) || data.girls[0];
  document.body.style.setProperty('--cover', girl.cover);
  document.body.style.setProperty('--accent', girl.accent);
  for (const t of tabsEl.children) t.setAttribute('aria-selected', String(t.dataset.slug === girl.slug));
  build(startPage);
}

function renderTabs() {
  tabsEl.innerHTML = data.girls.map((g) => `<button class="tab" role="tab" type="button" data-slug="${esc(g.slug)}"
      aria-controls="book" aria-selected="false" style="--tab:${esc(g.cover)}">${esc(g.name)}</button>`).join('');
  tabsEl.addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (t && t.dataset.slug !== girl.slug) selectGirl(t.dataset.slug);
  });
}

function fromHash() {
  const [slug, page] = location.hash.slice(1).split('/');
  return { slug, page: Math.max(0, parseInt(page, 10) || 0) };
}

// ---------- input ----------

function openViewer(i) {
  const a = pages[i]?.art;
  if (!a) return;
  const img = viewer.querySelector('img');
  img.src = a.src;
  img.alt = a.title || `Drawing by ${girl.name}`;
  viewer.querySelector('.viewer-caption').textContent = [a.title, formatDate(a.date)].filter(Boolean).join(' · ');
  viewer.showModal();
}

document.addEventListener('keydown', (e) => {
  if (!girl || viewer.open || e.altKey || e.ctrlKey || e.metaKey) return;
  const onButton = e.target.closest?.('button');
  switch (e.key) {
    case 'ArrowRight': case 'ArrowDown': case 'PageDown': go(1); break;
    case 'ArrowLeft': case 'ArrowUp': case 'PageUp': go(-1); break;
    case ' ': if (onButton) return; go(e.shiftKey ? -1 : 1); break;
    case 'Home': goTo(0); break;
    case 'End': goTo(maxTurn()); break;
    default: return;
  }
  e.preventDefault();
});

book.addEventListener('click', (e) => {
  const zoom = e.target.closest('.zoom');
  if (zoom) openViewer(+zoom.dataset.page);
});

prevBtn.addEventListener('click', () => go(-1));
nextBtn.addEventListener('click', () => go(1));

let start = null;
stage.addEventListener('pointerdown', (e) => {
  if (e.button === 0) start = { x: e.clientX, y: e.clientY, t: Date.now() };
});
stage.addEventListener('pointerup', (e) => {
  if (!start || !girl) return;
  const dx = e.clientX - start.x;
  const dy = e.clientY - start.y;
  start = null;
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) return go(dx < 0 ? 1 : -1);
  if (Math.hypot(dx, dy) > 10) return;
  if (e.target.closest('.zoom') || !e.target.closest('.book')) return;
  const r = book.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  go(x < (single ? 0.3 : 0.5) ? -1 : 1);
});
stage.addEventListener('pointercancel', () => { start = null; });

viewer.addEventListener('click', (e) => { if (e.target === viewer) viewer.close(); });

addEventListener('hashchange', () => {
  const { slug, page } = fromHash();
  if (slug && slug !== girl?.slug) selectGirl(slug, page);
});

let resizeTimer;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(layout, 80);
});

// ---------- start ----------

fetch('gallery.json')
  .then((r) => r.json())
  .then((json) => {
    data = json;
    renderTabs();
    layout();
    const { slug, page } = fromHash();
    selectGirl(slug, page);
  })
  .catch(() => {
    book.innerHTML = '<div class="page"><p class="blank">The sketchbook couldn\'t be opened. Please refresh.</p></div>';
  });
