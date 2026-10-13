// The drifting topographic contours behind every signed-out screen — the "atlas"
// in Acadlas. This is the marketing site's own script (src/lib/contours.ts, copied
// from marketing/src/scripts/contours.ts), so the product's background is not a
// lookalike of the website's; it is the same thing running.
//
// The script handles its own resize, visibility and reduced-motion behaviour, and
// raises a gentle hill under the pointer so the lines bend as you move across them.
import { useEffect, useRef } from 'react';
import { mountContours } from '../lib/contours';

export function ContourField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // The pointer area is the whole page, so the hill follows the cursor even while
    // someone is filling in the form.
    return mountContours(canvas, document.documentElement);
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0">
      <canvas ref={canvasRef} className="size-full" />
      {/* One warm light source top-right and a cool one bottom-left, as on the website. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(900px 620px at 82% -12%, rgba(244,166,42,.14), transparent 62%),' +
            'radial-gradient(760px 540px at 2% 102%, rgba(20,152,155,.16), transparent 60%)',
        }}
      />
    </div>
  );
}
