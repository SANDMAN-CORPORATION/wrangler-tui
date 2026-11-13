// Cloudflare dashboard and live URL construction.
// `:account` in dashboard URLs is a Cloudflare-internal placeholder —
// the dashboard interpolates it based on the authenticated account.

export function workerDashboardUrl(workerName) {
  if (!workerName || workerName === '(unnamed)') return null;
  return `https://dash.cloudflare.com/?to=/:account/workers/services/view/${encodeURIComponent(workerName)}/production`;
}

export function pagesDashboardUrl(projectName) {
  if (!projectName) return null;
  return `https://dash.cloudflare.com/?to=/:account/pages/view/${encodeURIComponent(projectName)}`;
}

/**
 * Extract the deployed URL from wrangler's output.
 * Workers: https://<name>.<subdomain>.workers.dev
 * Pages:   https://<name>.pages.dev or https://<hash>.<name>.pages.dev
 */
export function extractDeployedUrl(output) {
  if (!output || typeof output !== 'string') return null;
  const workers = output.match(/https:\/\/[a-zA-Z0-9-]+\.[a-zA-Z0-9-]+\.workers\.dev/);
  if (workers) return workers[0];
  const pages = output.match(/https:\/\/[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)?\.pages\.dev/);
  if (pages) return pages[0];
  return null;
}