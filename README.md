# Luna & Lara's Art Books

A one-page flipbook portfolio for Luna's and Lara's artwork. Each girl has her own tab and her own hardcover art book (purple for Luna, pink for Lara), with her newest drawing on the cover. Pages curl over like paper. Turn them with the arrow keys, the big buttons, a swipe or tap, or by dragging a page corner. "View big" opens any drawing full screen.

- **No build step.** The site is three small files in `public/` (`index.html`, `styles.css`, `app.js`) plus the page-curl library [StPageFlip](https://github.com/Nodlik/StPageFlip) (MIT), bundled in `public/vendor/` so the site doesn't depend on another server.
- **Fast:** artwork is resized to WebP at 640px and 1280px, and only the pages near the open one are downloaded. Image files are cached forever (see `public/_headers`).
- **Phones:** narrow or portrait screens show one page at a time. Wider screens show a two-page spread.
- **Updates itself:** every 15 minutes a GitHub Action checks the Google Drive folder. When drawings have been added, changed or removed, it updates the repo and Cloudflare redeploys. A check that finds nothing new takes about a second.

## How it fits together

```
Google Drive folder ──(GitHub Action, every 15 min)──▶ public/art + public/gallery.json ──(push)──▶ Cloudflare Pages
   ├── Luna/
   └── Lara/
```

## Setup

### 1. The Drive folder

The folder is set in `sketchbook.config.json` (`driveFolder`). It holds one subfolder per girl. A subfolder only has to *contain* her name, so `Luna`, `Luna's drawings` and `luna 2025` all work. Subfolders inside those, such as one per year, are included too.

The folder must stay shared as **Anyone with the link → Viewer**. No Google API key is needed.

### 2. GitHub

Nothing to configure. The job always works on `main`, so it doesn't matter which branch is the repo's default. To update the site straight away, open **Actions → Sync artwork from Google Drive → Run workflow**.

### 3. Cloudflare Pages

1. In the Cloudflare dashboard, go to **Workers & Pages → Create → Pages → Connect to Git** and pick this repo.
2. Production branch: `main`. Framework preset: **None**. Build command: *(leave empty)*. The output directory (`public`) comes from `wrangler.toml`.
3. Deploy. Every push to `main` redeploys, including the bot's artwork updates.

## Naming your files

The file name is how you control the book. Each name follows this pattern:

```
[number] Title.pdf
```

| Part | Needed? | What it does |
| --- | --- | --- |
| **Title** | Yes | The words shown under the drawing. Files without a real title are **left out of the book**. |
| **Number** | Optional | Sets the drawing's place: `01` comes first, then `02`, and so on. The number isn't shown. |

Examples:

| File name | In the book |
| --- | --- |
| `01 Rainbow.pdf` | Page 1, "Rainbow" |
| `02 Mermaids in red.pdf` | Page 2, "Mermaids in red" |
| `Unicorns by Luna.jpg` | "Unicorns" (after the numbered ones) |
| `Adobe Scan 23 Mar 2024.pdf` | Left out: no title |
| `IMG_2041.jpg`, `Luna (1).pdf`, `Art II.pdf` | Left out: no title |

Good to know:
- "by Luna", the girl's name at the start, dates and `(1)` copy numbers are tidied away automatically.
- Names made only of words like *art*, *drawing*, *painting*, *picture* or *untitled* don't count as titles.
- Numbering in tens (`10`, `20`, `30`) leaves room to slot new drawings in later.
- Drawings without a number come after the numbered ones, oldest first.
- A file whose name starts with the other girl's name (`Lara_Butterfly.pdf` in Luna's folder) goes into the other girl's book.
- Dates are never shown in the book.

## Day to day

- **Add a drawing:** drop a photo or PDF scan with a title in its name into the girl's folder. Each page of a PDF becomes its own book page. It usually shows up within 15 to 30 minutes. GitHub sometimes runs scheduled jobs late, so for an instant update, run the workflow by hand.
- **Rename to show a drawing:** a file that was left out appears as soon as it's renamed with a title.
- **Remove a drawing:** delete it from Drive. It disappears from the site at the next sync.
- **Hide a drawing without deleting it:** make a subfolder called `Hidden` (or `Archive`) inside the girl's folder and move the file there. Move it back to show it again.
- **Duplicates:** identical files are only shown once.
- **Formats:** PDF, JPG, PNG, WebP and most other image types. iPhone HEIC photos fall back to Drive's own preview copy.

## Customising

`sketchbook.config.json` holds each girl's name and cover colours. Change it, then run the sync.

## Local preview

```sh
npm install
npx serve public           # or: python3 -m http.server -d public
npm run sync               # pull artwork locally (needs pdftoppm from poppler-utils)
```
