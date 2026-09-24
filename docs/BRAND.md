# Rachet brand

Rachet is the public product name used by the landing page, sign-in, dashboard, CLI, and published SDK. Internal server contracts and environment variables retain historical `reflow` identifiers where they are part of the wire contract.

## Logo assets

Production assets live in `apps/dashboard/public/brand/`:

- `rachet-logo.svg`: dark wordmark with the yellow forward mark, for light backgrounds.
- `rachet-logo-light.svg`: cream wordmark with the yellow forward mark, for dark backgrounds.
- `rachet-mark.svg`: standalone yellow forward mark, with a transparent background.

Matching transparent PNG exports are included: wordmarks are 1600px wide, and the standalone mark is 512px square. Prefer SVG for interfaces and print.

The wordmark uses Inter Tight ExtraBold (800), with spacing reduced by 60 units per gap at 2048 units per em. Letters are outlined SVG paths, so the assets need no fonts, network requests, or raster images. The forward mark is a rounded triangle. Preserve the aspect ratio and leave at least half the cap height as clear space around the logo. The main logo should be at least 120px wide in interfaces.

Use the shared `RachetLogo` component in the dashboard. The favicon uses the yellow mark on the dark brand color.

## Social preview and search

`rachet-og.png` is the 1200 × 630 social preview, with an outlined SVG source in `rachet-og.svg`. It uses the same fonts, colors, and activation journey as the landing page. All lettering is outlined so sharing platforms do not need to load fonts.

The dashboard build prerenders the actual landing component into `dist/landing.html`. The production server serves that HTML at `/` and `/welcome`, with `/` as the canonical URL. Open Graph, Twitter large-image cards, description, and WebSite JSON-LD are in the initial HTML. The build also creates `login.html`, a data-free first-paint shell for sign-in. Authenticated routes are rendered after session verification because their workspace and workflow data must not be embedded in a shared document. The headline font is preloaded. The trusted runtime `PUBLIC_URL` supplies the origin for metadata, `/robots.txt`, and `/sitemap.xml`; a domain change requires configuration and a server restart, not a rebuild. Request host headers are never used for these URLs.

Only `/` appears in the sitemap. Sign-in and dashboard routes carry `noindex, nofollow` in both HTML and HTTP headers. Unknown routes return a real 404. Development Vite previews are marked `noindex`; validate production SEO through the backend after building, not through `vite preview` or a generic static file host, because the backend resolves deployment URL placeholders.

After deploying on the public domain, submit `/sitemap.xml` in Google Search Console and inspect `/`. Search rankings, indexing, and cached social previews are controlled by the respective platforms and cannot be verified from localhost.

## Typography

- **Primary:** Inter Tight Variable. Weight 800 for the landing headline and logo, 600–700 for interface headings, 400–500 for body copy and controls.
- **Secondary:** IBM Plex Mono. Weight 400 for small labels and metadata, 500–600 for emphasis and code.
- **Headline spacing:** `-0.045em`, with line height `1.02` on the landing hero.
- **Body spacing:** normal tracking, with comfortable line height. Keep monospace text for short supporting labels rather than paragraphs.

The fonts are self-hosted through pinned Fontsource packages. Inter Tight and IBM Plex Mono use the SIL Open Font License; their licenses ship in the packages. These are actual font files, not approximations of lettering in the supplied reference.

Sources: [Inter Tight](https://fonts.google.com/specimen/Inter+Tight), [Fontsource installation](https://fontsource.org/fonts/inter-tight/install), [IBM Plex](https://github.com/IBM/plex).

## Color

- Wordmark ink: `#281916`
- Forward mark: `#FFD43B`
- Inverse wordmark: `#FFFAF1`
- Interface surfaces and accents: the existing cream, yellow, pink, and mint tokens in `apps/dashboard/src/index.css`.
