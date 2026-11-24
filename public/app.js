// Luna & Lara's art books: a page-curl flipbook built on StPageFlip.
// Artwork comes from gallery.json, which the Drive sync keeps up to date.

const $ = (sel) => document.querySelector(sel);
const host = $('#book-host');
const stage = $('#stage');
const tabsEl = $('.tabs');
const prevBtn = $('#prev');
const nextBtn = $('#next');
const counter = $('#counter');
const fill = $('#fill');
const viewer = $('#viewer');

const PAGE_RATIO = 3 / 4; // page width / height
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
// On touch screens we read swipes and taps ourselves (see below); the library's
// own touch handling can turn the wrong way in single-page mode.
const touch = matchMedia('(pointer: coarse)').matches;

let data;
let girl;
let pages = []; // page descriptions, front cover first
let flip;       // the StPageFlip instance
let layoutKey = '';
let pageW = 0;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function formatDate(iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  return isNaN(d) ? '' : d.toLocaleDateString(undefined, opts);
}

// Pick the smaller image when it is sharp enough for the page on this screen.
const srcFor = (a) => (pageW * devicePixelRatio <= 700 && a.srcset ? a.src.replace(/-1280\.webp$/, '-640.webp') : a.src);

// ---------- pages ----------

function buildPages() {
  const art = girl.art || [];
  pages = [{ type: 'cover' }];
  art.forEach((a, i) => pages.push({ type: 'art', art: a, n: i + 1 }));
  if (!art.length) pages.push({ type: 'note', html: `<span class="big">🎨</span>${esc(girl.name)}'s first drawings are on their way!` });
  // With hard covers the back cover must land on a left-hand page.
  if (pages.length % 2 === 0) pages.push({ type: 'note', html: '<span class="big">✨</span>More art coming soon' });
  pages.push({ type: 'back' });
}

const ICON_ZOOM = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>';

function pageHTML(p, i) {
  const side = i % 2 ? 'left' : 'right';
  if (p.type === 'cover') {
    const art = girl.art || [];
    const feature = art.at(-1);
    return `<div class="page cover right" data-density="hard"><div class="page-inner">
      <span class="kicker">Art book</span>
      <h2>${esc(girl.name)}</h2>
      ${feature
        ? `<div class="feature"><img src="${esc(srcFor(feature))}" alt="" draggable="false"></div>`
        : '<div class="feature empty" aria-hidden="true">🖍️</div>'}
      <p class="meta">${art.length ? `<b>${art.length}</b> drawing${art.length === 1 ? '' : 's'}` : 'Coming soon'}</p>
    </div></div>`;
  }
  if (p.type === 'back') {
    return `<div class="page cover back left" data-density="hard"><div class="page-inner">
      <h2>The End<small>…for now!</small></h2>
      <button class="again" type="button" data-action="restart">Read again ↺</button>
    </div></div>`;
  }
  if (p.type === 'note') {
    return `<div class="page ${side}"><div class="page-inner"><p class="note">${p.html}</p></div></div>`;
  }
  const a = p.art;
  const label = a.title || `Drawing ${p.n}`;
  return `<div class="page ${side}"><div class="page-inner">
    <div class="art"><img src="${esc(srcFor(a))}" width="${a.w}" height="${a.h}" loading="lazy" decoding="async"
      style="--ph:${esc(a.color)}" alt="${esc(label)} by ${esc(girl.name)}" draggable="false"></div>
    <p class="caption"><span class="title">${esc(a.title)}</span></p>
    <button class="zoom" type="button" data-zoom="${i}" aria-label="View ${esc(label)} larger">${ICON_ZOOM}View big</button>
    <span class="folio">${p.n}</span>
  </div></div>`;
}

// ---------- the flipbook ----------

function computeLayout() {
  const w = stage.clientWidth - 32;
  const h = stage.clientHeight - 16;
  const spread = w >= 720 && w > h * 1.1;
  pageW = Math.floor(Math.max(150, Math.min(spread ? w / 2 : w, h * PAGE_RATIO)));
  return { spread, pageW, pageH: Math.floor(pageW / PAGE_RATIO) };
}

function build(startPage = 0) {
  const { spread, pageW: width, pageH: height } = computeLayout();
  layoutKey = `${girl.slug}|${spread}|${width}`;
  document.documentElement.style.setProperty('--page-w', `${width}px`);
  document.documentElement.style.setProperty('--page-h', `${height}px`);

  if (flip) flip.destroy(); // also removes its root element
  const root = document.createElement('div');
  host.replaceChildren(root);
  buildPages();
  root.innerHTML = pages.map(pageHTML).join('');

  flip = new St.PageFlip(root, {
    width,
    height,
    size: 'fixed',
    showCover: true,
    usePortrait: !spread,
    autoSize: true,
    maxShadowOpacity: 0.45,
    flippingTime: reduceMotion ? 300 : 800,
    mobileScrollSupport: false,
    useMouseEvents: !touch,
    startPage: Math.min(startPage, pages.length - 1),
    startZIndex: 1,
  });
  flip.loadFromHTML(root.querySelectorAll('.page'));
  flip.on('flip', update);
  flip.on('changeOrientation', update);
  // Slide a closed book back to the middle as soon as it starts to open.
  flip.on('changeState', (e) => { if (e.data === 'flipping') host.style.transform = 'translateX(0)'; });
  update();
}

function update() {
  if (!flip) return;
  const i = flip.getCurrentPageIndex();
  const total = pages.length;
  const landscape = flip.getOrientation() === 'landscape';
  host.classList.toggle('landscape', landscape);
  host.classList.toggle('portrait', !landscape);
  // A closed book shows one cover; slide it to the middle of the stage.
  const shift = !landscape ? 0 : i === 0 ? -pageW / 2 : i >= total - 1 ? pageW / 2 : 0;
  host.style.transform = `translateX(${shift}px)`;

  const visible = landscape && i > 0 ? [i, i + 1] : [i];
  const nums = visible.map((v) => pages[v]?.n).filter(Boolean);
  const count = girl.art?.length || 0;
  counter.textContent = i === 0 ? 'Cover'
    : nums.length ? `Page ${nums.join('–')} of ${count}`
    : visible.some((v) => pages[v]?.type === 'back') ? 'The End' : '';
  fill.style.width = `${Math.round((Math.min(i + (landscape && i ? 1 : 0), total - 1) / (total - 1)) * 100)}%`;
  prevBtn.disabled = i === 0;
  nextBtn.disabled = i >= total - 1 || (landscape && i + 1 >= total - 1 && i !== 0);

  // Warm the cache for the drawings a page or two ahead and behind.
  for (let k = Math.max(0, i - 2); k <= Math.min(total - 1, i + 4); k++) {
    if (pages[k]?.art) new Image().src = srcFor(pages[k].art);
  }
  const hash = `#${girl.slug}${i ? `/${i}` : ''}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

const next = () => flip?.flipNext('bottom');
const prev = () => flip?.flipPrev('bottom');

// ---------- tabs ----------

function selectGirl(slug, startPage = 0) {
  girl = data.girls.find((g) => g.slug === slug) || data.girls[0];
  document.body.style.setProperty('--theme', girl.cover);
  document.body.style.setProperty('--accent', girl.accent);
  document.querySelector('meta[name=theme-color]').content = girl.cover;
  document.title = `${girl.name}'s Art Book · Luna & Lara`;
  for (const t of tabsEl.children) t.setAttribute('aria-selected', String(t.dataset.slug === girl.slug));
  build(startPage);
}

function renderTabs() {
  tabsEl.innerHTML = data.girls.map((g) => `<button class="tab" role="tab" type="button" data-slug="${esc(g.slug)}"
      aria-controls="book-host" aria-selected="false" style="--tab:${esc(g.cover)}">
      <span class="dot" aria-hidden="true"></span>${esc(g.name)}
      <span class="count" aria-label="${g.art.length} drawings">${g.art.length}</span></button>`).join('');
  tabsEl.addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (t && t.dataset.slug !== girl.slug) selectGirl(t.dataset.slug);
  });
}

function fromHash() {
  const [slug, page] = location.hash.slice(1).split('/');
  return { slug, page: Math.max(0, parseInt(page, 10) || 0) };
}

// ---------- viewer ----------

function openViewer(i) {
  const a = pages[i]?.art;
  if (!a) return;
  const img = viewer.querySelector('img');
  img.src = a.src;
  img.alt = a.title || `Drawing by ${girl.name}`;
  viewer.querySelector('figcaption').innerHTML =
    `${esc(a.title)}<span>by ${esc(girl.name)}</span>`;
  viewer.showModal();
}

// Presses on buttons inside a page must not reach the flipbook, which would
// treat them as the start of a page turn (and on touch screens swallow the tap).
for (const type of ['mousedown', 'touchstart', 'pointerdown']) {
  host.addEventListener(type, (e) => { if (e.target.closest('button')) e.stopPropagation(); }, { capture: true });
}
host.addEventListener('click', (e) => {
  const zoom = e.target.closest('[data-zoom]');
  if (zoom) return openViewer(+zoom.dataset.zoom);
  if (e.target.closest('[data-action=restart]')) flip?.flip(0, 'top');
});
viewer.addEventListener('click', (e) => { if (e.target === viewer) viewer.close(); });

// ---------- keyboard & buttons ----------

document.addEventListener('keydown', (e) => {
  if (!flip || viewer.open || e.altKey || e.ctrlKey || e.metaKey) return;
  switch (e.key) {
    case 'ArrowRight': case 'ArrowDown': case 'PageDown': next(); break;
    case 'ArrowLeft': case 'ArrowUp': case 'PageUp': prev(); break;
    case ' ': if (e.target.closest?.('button')) return; e.shiftKey ? prev() : next(); break;
    case 'Home': flip.flip(0, 'top'); break;
    case 'End': flip.flip(pages.length - 1, 'top'); break;
    default: return;
  }
  e.preventDefault();
});
prevBtn.addEventListener('click', prev);
nextBtn.addEventListener('click', next);

addEventListener('hashchange', () => {
  const { slug, page } = fromHash();
  if (slug && slug !== girl?.slug) selectGirl(slug, page);
});

if (touch) {
  let start = null;
  host.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || e.target.closest('button')) return (start = null);
    start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  host.addEventListener('touchend', (e) => {
    if (!start || !flip) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    start = null;
    if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) return dx < 0 ? next() : prev();
    if (Math.hypot(dx, dy) < 10) {
      // A tap: left third goes back, anywhere else goes forward.
      const r = host.getBoundingClientRect();
      ((t.clientX - r.left) / r.width < (flip.getOrientation() === 'portrait' ? 1 / 3 : 1 / 2) ? prev : next)();
    }
  });
}

let resizeTimer;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!girl) return;
    const { spread, pageW: w } = computeLayout();
    const [, oldSpread, oldW] = layoutKey.split('|');
    if (String(spread) !== oldSpread || Math.abs(w - oldW) > 24) build(flip?.getCurrentPageIndex() || 0);
  }, 150);
});

// ---------- start ----------

fetch('gallery.json')
  .then((r) => r.json())
  .then((json) => {
    data = json;
    renderTabs();
    if (data.updated) {
      $('#foot-note').textContent = `Updated ${formatDate(data.updated.slice(0, 10), { day: 'numeric', month: 'long', year: 'numeric' })}`;
    }
    const { slug, page } = fromHash();
    selectGirl(slug, page);
  })
  .catch((err) => {
    console.error(err);
    host.innerHTML = '<p class="note">The art books couldn\'t be opened. Please refresh the page.</p>';
  });
