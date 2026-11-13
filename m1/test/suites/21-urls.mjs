import { assertEqual, assert } from '../helpers.mjs';
import {
  workerDashboardUrl, pagesDashboardUrl, extractDeployedUrl,
} from '../../src/urls.mjs';

export const name = 'urls';

export const tests = [
  {
    name: 'workerDashboardUrl builds correct URL',
    fn: async () => {
      const u = workerDashboardUrl('my-worker');
      assertEqual(u, 'https://dash.cloudflare.com/?to=/:account/workers/services/view/my-worker/production');
    },
  },
  {
    name: 'workerDashboardUrl returns null for unnamed',
    fn: async () => {
      assertEqual(workerDashboardUrl('(unnamed)'), null);
      assertEqual(workerDashboardUrl(''), null);
      assertEqual(workerDashboardUrl(null), null);
    },
  },
  {
    name: 'workerDashboardUrl encodes special characters',
    fn: async () => {
      const u = workerDashboardUrl('my worker/x');
      assert(u.includes('my%20worker%2Fx'));
    },
  },
  {
    name: 'pagesDashboardUrl builds correct URL',
    fn: async () => {
      const u = pagesDashboardUrl('my-site');
      assertEqual(u, 'https://dash.cloudflare.com/?to=/:account/pages/view/my-site');
    },
  },
  {
    name: 'pagesDashboardUrl returns null for empty',
    fn: async () => {
      assertEqual(pagesDashboardUrl(''), null);
      assertEqual(pagesDashboardUrl(null), null);
    },
  },
  {
    name: 'extractDeployedUrl finds workers.dev URL',
    fn: async () => {
      const out = 'Deployed zsar triggers (2.55 sec)\n  https://zsar.zsarpi.workers.dev\nCurrent Version ID: xxx';
      assertEqual(extractDeployedUrl(out), 'https://zsar.zsarpi.workers.dev');
    },
  },
  {
    name: 'extractDeployedUrl finds pages.dev URL',
    fn: async () => {
      const out = '✨ Deployment complete! Take a peek over at https://mysite.pages.dev';
      assertEqual(extractDeployedUrl(out), 'https://mysite.pages.dev');
    },
  },
  {
    name: 'extractDeployedUrl finds hashed pages.dev URL',
    fn: async () => {
      const out = 'Deployment complete! https://abc123.mysite.pages.dev';
      assertEqual(extractDeployedUrl(out), 'https://abc123.mysite.pages.dev');
    },
  },
  {
    name: 'extractDeployedUrl returns null for no URL',
    fn: async () => {
      assertEqual(extractDeployedUrl('Deployed ok'), null);
      assertEqual(extractDeployedUrl(''), null);
      assertEqual(extractDeployedUrl(null), null);
    },
  },
  {
    name: 'extractDeployedUrl prefers workers.dev over pages.dev',
    fn: async () => {
      const out = 'pages: https://site.pages.dev worker: https://w.sub.workers.dev';
      assertEqual(extractDeployedUrl(out), 'https://w.sub.workers.dev');
    },
  },
];