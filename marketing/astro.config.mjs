// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// The production domain is not decided yet. When it is, build with SITE_URL set
// (for example `SITE_URL=https://example.com npm run build`) and the canonical link,
// absolute Open Graph URL and structured data switch on. Without it none of them are emitted.
const site = process.env.SITE_URL || undefined;

// https://astro.build/config
export default defineConfig({
  site,
  vite: {
    plugins: [tailwindcss()]
  }
});
