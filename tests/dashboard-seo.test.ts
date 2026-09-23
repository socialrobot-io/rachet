import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterAll, describe, expect, it } from 'vitest';
import { mountDashboard } from '../apps/server/src/dashboard.js';

const root = mkdtempSync(join(tmpdir(), 'rachet-seo-'));
const template = readFileSync('apps/dashboard/index.html', 'utf8');
writeFileSync(join(root, 'index.html'), template);
writeFileSync(join(root, 'landing.html'), template.replace('<div id="root"></div>', '<div id="root"><h1>Build customer journeys by asking.</h1></div>'));
mkdirSync(join(root, 'brand'));
writeFileSync(join(root, 'brand/rachet-og.png'), readFileSync('apps/dashboard/public/brand/rachet-og.png'));
writeFileSync(join(root, 'favicon.svg'), readFileSync('apps/dashboard/public/favicon.svg'));
const app = new Hono();
app.get('/api/health', (c) => c.json({ ok: true }));
mountDashboard(app, root, 'https://rachet.example.test');
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('landing SEO and static serving', () => {
  it.each(['/', '/welcome', '/?utm_source=launch'])('serves crawler-readable content and absolute metadata at %s', async (path) => {
    const response = await app.request(`https://untrusted.example${path}`, { headers: { 'X-Forwarded-Host': 'untrusted.example' } });
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('<h1>Build customer journeys by asking.</h1>');
    expect(html).toContain('<link rel="canonical" href="https://rachet.example.test/"');
    expect(html).toContain('content="https://rachet.example.test/brand/rachet-og.png"');
    expect(html).toContain('content="summary_large_image"');
    expect(html).toContain('content="index, follow, max-image-preview:large"');
    expect(html).not.toMatch(/__RACHET_PUBLIC_URL__|untrusted\.example/);
    const json = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)?.[1];
    expect(JSON.parse(json ?? '{}')).toMatchObject({ '@type': 'WebSite', name: 'Rachet', url: 'https://rachet.example.test/' });
  });

  it.each(['/login', '/auth/login', '/auth/consent?client_id=example', '/workflows', '/workflows/wf-123', '/enrollments/enr-123', '/settings/api-keys', '/settings/connected-apps', '/settings/integrations', '/onboarding/integrations/resend'])('excludes app route %s from indexing', async (path) => {
    const response = await app.request(path);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow"');
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('<h1>');
  });

  it('exposes a sitemap containing only the canonical landing URL', async () => {
    const sitemap = await app.request('/sitemap.xml');
    expect(sitemap.headers.get('content-type')).toContain('application/xml');
    expect(await sitemap.text()).toContain('<url><loc>https://rachet.example.test/</loc></url>');
    const robots = await (await app.request('/robots.txt')).text();
    expect(robots).toContain('Sitemap: https://rachet.example.test/sitemap.xml');
    expect(robots).not.toContain('Disallow: /login');
  });

  it.each(['/not-a-page', '/assets/missing.js', '//', '/brand/missing.png'])('returns a real non-indexable 404 for %s', async (path) => {
    const response = await app.request(`https://rachet.example.test${path}`);
    expect(response.status).toBe(404);
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it.each(['/index.html', '/%69ndex.html', '/landing.html'])('redirects build template %s to the canonical page', async (path) => {
    const response = await app.request(path);
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('/');
  });

  it('serves the real 1200 by 630 PNG and favicon without authentication', async () => {
    const response = await app.request('/brand/rachet-og.png');
    expect(response.headers.get('content-type')).toBe('image/png');
    const png = Buffer.from(await response.arrayBuffer());
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    expect((await app.request('/favicon.svg')).headers.get('content-type')).toContain('image/svg+xml');
    expect(await (await app.request('/api/health')).json()).toEqual({ ok: true });
  });
});
