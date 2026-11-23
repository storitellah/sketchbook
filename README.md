# Luna & Lara's Sketchbook

A one-page flip-book portfolio for Luna's and Lara's artwork. Each girl has her own tab and her own sketchbook. Pages turn with the arrow keys, the on-screen buttons, a swipe, or a tap.

- **No build step and no frameworks.** The site is three small files in `public/`: `index.html`, `styles.css` and `app.js`.
- **Fast:** artwork is resized to WebP at 640px and 1280px, and only the pages near the open one are downloaded. Image files are cached forever (see `public/_headers`).
- **Phones:** narrow or portrait screens show one page at a time. Wider screens show a two-page spread.
- **Updates itself:** every hour a GitHub Action checks the Google Drive folder. When drawings have been added, changed or removed, it updates the repo and Cloudflare redeploys.

## How it fits together

```
Google Drive folder ──(hourly GitHub Action)──▶ public/art + public/gallery.json ──(push)──▶ Cloudflare Pages
   ├── Luna/
   └── Lara/
```

## Setup

### 1. The Drive folder

The folder is set in `sketchbook.config.json` (`driveFolder`). It holds one subfolder per girl. A subfolder only has to *contain* her name, so `Luna`, `Luna's drawings` and `luna 2025` all work. Subfolders inside those, such as one per year, are included too.

The folder must stay shared as **Anyone with the link → Viewer**. No Google API key is needed.

### 2. GitHub

Nothing to configure. To update the site straight away, without waiting for the hourly run, open **Actions → Sync artwork from Google Drive → Run workflow**.

### 3. Cloudflare Pages

1. In the Cloudflare dashboard, go to **Workers & Pages → Create → Pages → Connect to Git** and pick this repo.
2. Production branch: `main`. Framework preset: **None**. Build command: *(leave empty)*. The output directory (`public`) comes from `wrangler.toml`.
3. Deploy. Every push to `main` redeploys, including the bot's artwork updates.

## Day to day

- **Add a drawing:** drop a photo or a PDF scan into the girl's folder. Each page of a PDF becomes its own sketchbook page. It shows up on the site within about an hour. To get it there sooner, run the workflow by hand.
- **Order:** drawings are sorted oldest to newest. The date comes from the file name (`Adobe Scan Jun 14, 2025.pdf`), otherwise from the scan or photo itself. Drawings with no date go at the end.
- **Captions:** the file name becomes the caption, so `Rainbow by Luna.pdf` is captioned "Rainbow". Names like `Adobe Scan …` or `IMG_2041.jpg` get no caption.
- **Wrong folder?** A file whose name starts with the other girl's name (`Lara_scan.pdf` in Luna's folder) goes into the other girl's book.
- **Duplicates:** identical files are only shown once.
- **Remove a drawing:** delete it from Drive. It disappears from the site at the next sync.
- **Formats:** PDF, JPG, PNG, WebP and most other image types. iPhone HEIC photos fall back to Drive's own preview copy.

## Customising

`sketchbook.config.json` holds each girl's name and cover colours. Change it, then run the sync.

## Local preview

```sh
npm install
npx serve public           # or: python3 -m http.server -d public
npm run sync               # pull artwork locally (needs pdftoppm from poppler-utils)
```
