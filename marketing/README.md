# Acadlas marketing site

The public homepage for Acadlas. Astro 7, Tailwind CSS v4, no client framework; interactive pieces are small
TypeScript modules in `src/scripts`, with GSAP used for the one pinned scroll scene. It is separate from the React
application in `../apps`.

## Commands

| Command                  | Action                                                  |
| :----------------------- | :------------------------------------------------------ |
| `npm install`            | Install dependencies                                    |
| `npm run dev`            | Dev server at `localhost:4321`                          |
| `npm run build`          | Production build to `./dist/`                           |
| `npm run preview`        | Serve the production build locally                      |
| `npm run brand:optimize` | Regenerate the web-ready logo and favicon files (below) |

## Structure

```text
src/
├── pages/index.astro          Page title and description; assembles the sections in order
├── layouts/Layout.astro       <head>, SEO, favicon links, font, reveal-on-scroll script
├── components/
│   ├── Header.astro           Floating navy capsule: logo, section links with active state, mobile menu
│   ├── Hero.astro             Headline, contour-map background, draggable record constellation
│   ├── Why.astro              Pinned scroll scene: seven scraps of paper gather into one student record
│   ├── Workflow.astro         Six-step flow with a sticky product window that fills a student record
│   ├── Playground.astro       Working demo: attendance register, fee payment, admission (sample data)
│   ├── Ecosystem.astro        Product map: School now, Institute and Campus planned, the rest explored
│   ├── Foundations.astro      How the product is being built (data separation, roles, phones, audit)
│   ├── Faq.astro              Questions schools ask, with FAQPage structured data
│   ├── Closing.astro          Closing message and calls to action
│   ├── Footer.astro
│   └── Icon.astro             Stroke icon renderer
├── scripts/
│   ├── contours.ts            Animated topographic contour lines (canvas) that bend around the pointer
│   ├── constellation.ts       Spring-physics record constellation in the hero
│   ├── gather.ts              GSAP ScrollTrigger timeline for the Why section
│   └── playground.ts          Logic for the three demo tasks
├── data/site.ts               Navigation links and the (optional) contact email
├── data/icons.ts              Icon path data
├── styles/global.css          Design tokens (@theme), base styles, shared components, motion
└── assets/brand/              Generated wordmarks (navy and white) used by the header and footer
```

## Design system

- **Type:** Archivo (variable, weight and width axes) only. Headings run expanded (`font-stretch: 125%`) and heavy;
  body copy runs at normal width. The hero headline animates from condensed to expanded once on load.
- **Colour:** every token comes from the brand artwork. Navy (`night`, `ink`) from the wordmark; `lagoon` teal,
  `cobalt` and `marigold` from the network mark. `coral` is reserved for absent and overdue states in product
  previews. Tailwind's default palette is reset, so nothing outside these tokens can be used by accident.
- **Radius:** 26px for product windows, 18px for panels, 10px for controls, 6px for chips; pills for buttons.
- **Motion:** one orchestrated hero entrance, a scroll-driven gather scene, and motion that answers the visitor
  (dragging, tapping, demo actions). Everything respects `prefers-reduced-motion`: animations stop, the pinned scene
  shows its finished state, and dragging still works. Canvases pause when off-screen or in a hidden tab.

## Content rules

Acadlas School is **in development**. The page describes intended scope only, so keep it free of availability,
pricing, customer, testimonial or usage claims until they are true. Every name, figure and record on the page is
illustrative sample data and is labelled as such. The ecosystem map says plainly that only Acadlas School is being
built.

The page links only to its own sections until a contact route exists. To add one, set `contactEmail` in
`src/data/site.ts`; the closing section and footer then show an email action automatically.

## Production domain

The domain is not decided, so the build emits no canonical link, absolute Open Graph URL or organisation structured
data. Set `SITE_URL` when it is known:

```sh
SITE_URL=https://your-domain.example npm run build
```

An Open Graph / social-share image is also not set; add one once a suitable 1200×630 asset exists.

## Brand assets

The originals are `public/branding-acadlas.png` and `public/favicon-acadlas.png`. They are never edited.
`npm run brand:optimize` reads them and writes the files the site actually uses:

- `src/assets/brand/acadlas-wordmark.png` (navy, for light surfaces)
- `src/assets/brand/acadlas-wordmark-light.png` (white on transparency, for navy surfaces)
- `public/favicon-32x32.png`, `public/favicon-192x192.png`, `public/apple-touch-icon.png`

The script's header comment lists exactly what it changes (orientation, near-white background noise, empty margin).
When a corrected logo export is supplied, replace the original in `public/` and re-run it.
