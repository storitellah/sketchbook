// Cloudflare Worker that starts the "Sync artwork from Google Drive" GitHub
// Action on a schedule. GitHub's own schedule often runs hours late; a
// Cloudflare cron trigger fires on time, so new drawings show up within
// minutes of being added to Drive.
//
// Settings (Worker → Settings → Variables and Secrets):
//   GITHUB_TOKEN  (secret)  fine-grained token for storitellah/sketchbook
//                           with "Actions: Read and write"
//   GITHUB_REPO   (text)    storitellah/sketchbook
// Trigger (Worker → Settings → Trigger events): cron */10 * * * *

const WORKFLOW = 'sync-drive.yml';

async function startSync(env) {
  const repo = env.GITHUB_REPO || 'storitellah/sketchbook';
  if (!env.GITHUB_TOKEN) throw new Error('The GITHUB_TOKEN secret is not set on this Worker.');
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'sketchbook-sync-trigger',
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (!res.ok) {
    const hint = res.status === 401 ? ' (token wrong or expired)'
      : res.status === 403 || res.status === 404 ? ' (token missing "Actions: Read and write" on the repo)' : '';
    throw new Error(`GitHub answered ${res.status}${hint}: ${await res.text()}`);
  }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(startSync(env).then(
      () => console.log('Started the artwork sync.'),
      (err) => { console.error(err.message); throw err; },
    ));
  },

  // Visiting the Worker's address only shows that it's alive; it doesn't start a sync.
  async fetch() {
    return new Response('Sketchbook sync trigger is running. It starts the Google Drive sync every 10 minutes.\n', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};
