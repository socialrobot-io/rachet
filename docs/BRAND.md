# Rachet brand

Use **Rachet** in user-facing text, package names, skills, commands, and new configuration keys. Preserve old identifiers only where an existing installation still needs them to read data or complete in-flight work.

## Logo assets

Production assets live in `apps/dashboard/public/brand/`:

- `rachet-logo.svg`: dark wordmark with the hand-drawn robot head, for light backgrounds.
- `rachet-logo-light.svg`: cream wordmark with the robot head, for dark backgrounds.
- `rachet-mark.svg`: standalone robot head with a transparent background.
- `rachet-mascot.png`: transparent full-body robot for illustrations.

Transparent PNG exports are also available. Prefer SVG in interfaces and print.

The wordmark uses outlined Inter Tight ExtraBold (800) paths. Keep its aspect ratio, leave clear space equal to half the cap height, and use at least 120px width in interfaces. Use the full-body mascot at 80px high or larger so its ink detail stays clear.

Use the shared `RachetLogo` component in the dashboard. The favicon uses the robot head on the dark brand color.
Brand image URLs carry a version so cached copies update when the artwork changes. Change the URL version when replacing a deployed asset at the same path.

## Social preview and search

`rachet-og.png` is the 1200 × 630 social preview. Its source is `rachet-og.svg`.

The build creates the landing page HTML and social metadata. The server uses `PUBLIC_URL` for the canonical URL, `robots.txt`, and `sitemap.xml`. Only `/` is in the sitemap; sign-in and dashboard pages are not indexed.

After deployment, inspect `/` and submit `/sitemap.xml` in Google Search Console. Test search and social previews against the deployed server, not a local Vite preview.

## Typography

- **Primary:** Inter Tight Variable. Weight 800 for the landing headline and logo, 600–700 for interface headings, 400–500 for body copy and controls.
- **Secondary:** IBM Plex Mono. Weight 400 for small labels and metadata, 500–600 for emphasis and code.
- **Headline spacing:** `-0.045em`, with line height `1.02` on the landing hero.
- **Body spacing:** normal tracking, with comfortable line height. Keep monospace text for short supporting labels rather than paragraphs.

The fonts are self-hosted through pinned Fontsource packages. Their licenses ship in the packages.

Sources: [Inter Tight](https://fonts.google.com/specimen/Inter+Tight), [Fontsource installation](https://fontsource.org/fonts/inter-tight/install), [IBM Plex](https://github.com/IBM/plex).

## Color

- Wordmark ink: `#281916`
- Robot accent: `#FFD43B`
- Inverse wordmark: `#FFFAF1`
- Interface surfaces and accents: the existing cream, yellow, pink, and mint tokens in `apps/dashboard/src/index.css`.
