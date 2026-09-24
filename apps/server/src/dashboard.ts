import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Hono } from 'hono';

const appRoutes = /^\/(?:login|auth\/(?:login|consent)|workflows(?:\/[^/]+)?|enrollments\/[^/]+|(?:settings|onboarding)\/integrations(?:\/resend)?|settings\/(?:connected-apps|api-keys))\/?$/;

export function mountDashboard(app: Hono, root: string, publicUrl: string, googleAnalyticsId?: string) {
  if (!existsSync(join(root, 'index.html'))) return false;
  // Only trusted deployment configuration can supply canonical and sharing URLs.
  const origin = new URL(publicUrl).origin;
  const shell = readFileSync(join(root, 'index.html'), 'utf8').replaceAll('__RACHET_PUBLIC_URL__', origin);
  const landingPath = join(root, 'landing.html');
  const landing = existsSync(landingPath)
    ? readFileSync(landingPath, 'utf8').replaceAll('__RACHET_PUBLIC_URL__', origin)
    : shell;
  const loginPath = join(root, 'login.html');
  const login = existsSync(loginPath)
    ? readFileSync(loginPath, 'utf8').replaceAll('__RACHET_PUBLIC_URL__', origin)
    : shell;
  const analytics = googleAnalyticsId
    ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${googleAnalyticsId}"></script><script>window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag('js', new Date()); gtag('config', '${googleAnalyticsId}');</script>`
    : '';
  const publicLanding = landing.replace('<!-- RACHET_ANALYTICS -->', analytics);
  const privateShell = shell.replace('content="index, follow, max-image-preview:large"', 'content="noindex, nofollow"')
    .replace(/<link rel="canonical"[^>]*>/, '')
    .replace(/<title>[^<]*<\/title>/, '<title>Rachet | Dashboard</title>');
  const privatePage = (page: string) => page.replace('content="index, follow, max-image-preview:large"', 'content="noindex, nofollow"')
    .replace(/<link rel="canonical"[^>]*>/, '')
    .replace(/<title>[^<]*<\/title>/, '<title>Rachet | Dashboard</title>');
  const privateLogin = privatePage(login);

  app.get('/robots.txt', (c) => c.text(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /v1/\nDisallow: /mcp\n\nSitemap: ${origin}/sitemap.xml\n`));
  app.get('/sitemap.xml', (c) => c.body(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url></urlset>`, 200, { 'Content-Type': 'application/xml; charset=UTF-8' }));
  app.get('/', (c) => c.html(publicLanding));
  app.get('/welcome', (c) => c.html(publicLanding));
  // Prevent direct access to build templates and their unresolved metadata.
  app.get('/index.html', (c) => c.redirect('/', 301));
  app.get('/landing.html', (c) => c.redirect('/', 301));
  app.get('/login.html', (c) => c.redirect('/login', 301));
  app.use('/assets/*', serveStatic({ root }));
  app.use('/brand/*', serveStatic({ root }));
  app.get('/favicon.svg', serveStatic({ root }));
  app.get('*', (c) => {
    c.header('X-Robots-Tag', 'noindex, nofollow');
    if (appRoutes.test(c.req.path)) {
      if (/^\/(?:login|auth\/login)\/?$/.test(c.req.path)) return c.html(privateLogin);
      return c.html(privateShell);
    }
    return c.html('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Page not found | Rachet</title></head><body><main><h1>Page not found</h1><p><a href="/">Go to Rachet</a></p></main></body></html>', 404);
  });
  return true;
}
