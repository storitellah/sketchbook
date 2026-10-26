# Luna & Lara's Sketchbook

A one-page flip-book portfolio for Luna's and Lara's artwork. Each girl has her own tab and her own sketchbook. Pages turn with the arrow keys, the on-screen buttons, a swipe, or a tap.

- **No build step and no frameworks.** The site is three small files in `public/`: `index.html`, `styles.css` and `app.js`.
- **Fast:** artwork is resized to WebP at 640px and 1280px, and only the pages near the open one are downloaded. Image files are cached forever (see `public/_headers`).
- **Phones:** narrow or portrait screens show one page at a time. Wider screens show a two-page spread.
- **Updates itself:** every hour a GitHub Action checks the Google Drive folder. When drawings have been added, changed or removed, it updates the repo and Cloudflare redeploys.

The site ships with six placeholder drawings so you can review it. The first Drive sync replaces them.

## How it fits together

```
Google Drive folder ──(hourly GitHub Action)──▶ public/art + public/gallery.json ──(push)──▶ Cloudflare Pages
   ├── Luna/
   └── Lara/
```

## One-time setup

### 1. Share the Drive folder

Make a top-level folder that contains one subfolder per girl. A subfolder only has to *contain* her name, so `Luna`, `Luna's drawings` and `luna 2025` all work. Subfolders inside those, such as one per year, are included too.

Share the top-level folder as **Anyone with the link → Viewer**.

### 2. Get a Google API key

1. Open <https://console.cloud.google.com/>, then create a project (or pick an existing one).
2. Go to **APIs & Services → Library**, search for **Google Drive API**, and click **Enable**.
3. Go to **APIs & Services → Credentials → Create credentials → API key**.
4. Optional but recommended: edit the key and set **API restrictions → Restrict key → Google Drive API**.

### 3. Add the settings to GitHub

In this repo, open **Settings → Secrets and variables → Actions**:

- **Secrets** tab → new secret `GOOGLE_API_KEY` = the key from step 2
- **Variables** tab → new variable `DRIVE_FOLDER` = the shared folder's link (the full link is fine)

Then open **Actions → Sync artwork from Google Drive → Run workflow** to do the first sync now instead of waiting for the hourly run.

### 4. Host on Cloudflare Pages

1. In the Cloudflare dashboard, go to **Workers & Pages → Create → Pages → Connect to Git** and pick this repo.
2. Production branch: `main`. Framework preset: **None**. Build command: *(leave empty)*. Build output directory: `public`.
3. Deploy. Every push to `main` redeploys, including the bot's artwork updates.

## Day to day

- **Add a drawing:** drop a photo or scan into the girl's folder. It shows up on the site within about an hour. To get it there sooner, run the workflow by hand.
- **Order:** drawings are sorted oldest to newest, using the date the photo was taken (or the upload date if the photo has none).
- **Captions:** the file name becomes the caption, so `Rainbow Cat.jpg` is captioned "Rainbow Cat". Camera names like `IMG_2041.jpg` are left without a caption.
- **Remove a drawing:** delete it from Drive. It disappears from the site at the next sync.
- **Formats:** JPG, PNG, WebP and most others work. iPhone HEIC photos fall back to Drive's own preview copy.

## Customising

`sketchbook.config.json` holds each girl's name and cover colours. Change it, then run the sync.

## Local preview

```sh
npm install
npx serve public           # or: python3 -m http.server -d public
GOOGLE_API_KEY=… DRIVE_FOLDER=… npm run sync   # pull artwork locally
```
