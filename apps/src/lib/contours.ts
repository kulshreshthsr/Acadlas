// Animated topographic contour lines for the hero background — the "atlas" in Acadlas.
// A slowly drifting noise field is traced with marching squares; the pointer raises a
// gentle hill so the contour lines bend around it. Pauses when off-screen or hidden,
// and draws a single still frame when the visitor prefers reduced motion.

type Options = {
  cell?: number;
  levels?: number[];
  /** Draw one frame and never animate — for surfaces people work on all day. */
  still?: boolean;
  /** Where in the noise field to start. A school's id hashed here gives each school its own terrain. */
  seed?: number;
};

// Compact 3D simplex noise (Stefan Gustavson's reference, public domain).
const grad3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

function buildPermutation(seed: number) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = perm[i] % 12;
  }
  return { perm, permMod12 };
}

const { perm, permMod12 } = buildPermutation(20260411);
const F3 = 1 / 3;
const G3 = 1 / 6;

function simplex3(xin: number, yin: number, zin: number) {
  let n0 = 0,
    n1 = 0,
    n2 = 0,
    n3 = 0;
  const s = (xin + yin + zin) * F3;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const k = Math.floor(zin + s);
  const t = (i + j + k) * G3;
  const x0 = xin - (i - t);
  const y0 = yin - (j - t);
  const z0 = zin - (k - t);
  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) {
    if (y0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 1, 0];
    else if (x0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 0, 1];
    else [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 1, 0, 1];
  } else {
    if (y0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 0, 1, 1];
    else if (x0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 0, 1, 1];
    else [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 1, 1, 0];
  }
  const x1 = x0 - i1 + G3,
    y1 = y0 - j1 + G3,
    z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2 * G3,
    y2 = y0 - j2 + 2 * G3,
    z2 = z0 - k2 + 2 * G3;
  const x3 = x0 - 1 + 3 * G3,
    y3 = y0 - 1 + 3 * G3,
    z3 = z0 - 1 + 3 * G3;
  const ii = i & 255,
    jj = j & 255,
    kk = k & 255;

  let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
  if (t0 > 0) {
    const g = permMod12[ii + perm[jj + perm[kk]]] * 3;
    t0 *= t0;
    n0 = t0 * t0 * (grad3[g] * x0 + grad3[g + 1] * y0 + grad3[g + 2] * z0);
  }
  let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
  if (t1 > 0) {
    const g = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3;
    t1 *= t1;
    n1 = t1 * t1 * (grad3[g] * x1 + grad3[g + 1] * y1 + grad3[g + 2] * z1);
  }
  let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
  if (t2 > 0) {
    const g = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3;
    t2 *= t2;
    n2 = t2 * t2 * (grad3[g] * x2 + grad3[g + 1] * y2 + grad3[g + 2] * z2);
  }
  let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
  if (t3 > 0) {
    const g = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3;
    t3 *= t3;
    n3 = t3 * t3 * (grad3[g] * x3 + grad3[g + 1] * y3 + grad3[g + 2] * z3);
  }
  return 32 * (n0 + n1 + n2 + n3);
}

export function mountContours(canvas: HTMLCanvasElement, pointerArea: HTMLElement, options: Options = {}): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const reduceMotion = options.still || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const levels = options.levels ?? [-0.55, -0.42, -0.3, -0.18, -0.06, 0.06, 0.18, 0.3, 0.42, 0.55, 0.68];
  let cell = options.cell ?? 16;

  let width = 0;
  let height = 0;
  let cols = 0;
  let rows = 0;
  let field = new Float32Array(0);
  let dpr = 1;

  const pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999, strength: 0, target: 0 };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    cell = width < 640 ? 14 : (options.cell ?? 16);
    cols = Math.ceil(width / cell) + 1;
    rows = Math.ceil(height / cell) + 1;
    field = new Float32Array(cols * rows);
  }

  function sample(time: number) {
    const scale = 0.0021;
    const px = pointer.x;
    const py = pointer.y;
    const radius = Math.max(width, height) * 0.16;
    const r2 = radius * radius;
    for (let r = 0; r < rows; r++) {
      const y = r * cell;
      for (let c = 0; c < cols; c++) {
        const x = c * cell;
        let v = simplex3(x * scale, y * scale, time) * 0.75 + simplex3(x * scale * 2.3, y * scale * 2.3, time * 1.6) * 0.25;
        if (pointer.strength > 0.001) {
          const dx = x - px;
          const dy = y - py;
          v += Math.exp(-(dx * dx + dy * dy) / r2) * 0.55 * pointer.strength;
        }
        field[r * cols + c] = v;
      }
    }
  }

  function draw() {
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.clearRect(0, 0, width, height);
    ctx!.lineWidth = 1;
    ctx!.lineJoin = 'round';

    levels.forEach((level, li) => {
      ctx!.beginPath();
      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const a = field[r * cols + c];
          const b = field[r * cols + c + 1];
          const d = field[(r + 1) * cols + c];
          const e = field[(r + 1) * cols + c + 1];
          let idx = 0;
          if (a > level) idx |= 8;
          if (b > level) idx |= 4;
          if (e > level) idx |= 2;
          if (d > level) idx |= 1;
          if (idx === 0 || idx === 15) continue;

          const x = c * cell;
          const y = r * cell;
          const top = x + cell * ((level - a) / (b - a));
          const right = y + cell * ((level - b) / (e - b));
          const bottom = x + cell * ((level - d) / (e - d));
          const left = y + cell * ((level - a) / (d - a));

          const seg = (x1: number, y1: number, x2: number, y2: number) => {
            ctx!.moveTo(x1, y1);
            ctx!.lineTo(x2, y2);
          };

          switch (idx) {
            case 1:
            case 14:
              seg(x, left, bottom, y + cell);
              break;
            case 2:
            case 13:
              seg(bottom, y + cell, x + cell, right);
              break;
            case 3:
            case 12:
              seg(x, left, x + cell, right);
              break;
            case 4:
            case 11:
              seg(top, y, x + cell, right);
              break;
            case 5:
              seg(x, left, top, y);
              seg(bottom, y + cell, x + cell, right);
              break;
            case 6:
            case 9:
              seg(top, y, bottom, y + cell);
              break;
            case 7:
            case 8:
              seg(x, left, top, y);
              break;
            case 10:
              seg(top, y, x + cell, right);
              seg(x, left, bottom, y + cell);
              break;
          }
        }
      }
      // Index lines (every fourth) are slightly brighter, as on a survey map.
      const isIndex = li % 4 === 1;
      const isPeak = li === levels.length - 1;
      ctx!.strokeStyle = isPeak
        ? 'rgba(248, 187, 76, 0.32)'
        : isIndex
          ? 'rgba(111, 207, 204, 0.26)'
          : 'rgba(111, 207, 204, 0.11)';
      ctx!.lineWidth = isIndex || isPeak ? 1.15 : 1;
      ctx!.stroke();
    });
  }

  let running = false;
  let visible = true;
  let raf = 0;
  let last = 0;
  let clock = options.seed ?? Math.random() * 10;

  function frame(now: number) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (now - last < 33) return; // ~30fps is plenty for slow drift
    const dt = Math.min(now - last, 100);
    last = now;
    clock += dt * 0.000045;

    pointer.x += (pointer.tx - pointer.x) * 0.12;
    pointer.y += (pointer.ty - pointer.y) * 0.12;
    pointer.strength += (pointer.target - pointer.strength) * 0.06;

    sample(clock);
    draw();
  }

  function start() {
    if (running || reduceMotion || !visible || document.hidden) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  resize();
  sample(clock);
  draw();

  const resizeObserver = new ResizeObserver(() => {
    resize();
    sample(clock);
    draw();
  });
  resizeObserver.observe(canvas);

  const intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) start();
    else stop();
  });
  intersectionObserver.observe(canvas);

  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVisibility);

  const onPointerMove = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    pointer.tx = event.clientX - rect.left;
    pointer.ty = event.clientY - rect.top;
    if (pointer.x < -9000) {
      pointer.x = pointer.tx;
      pointer.y = pointer.ty;
    }
    pointer.target = 1;
  };
  const onPointerLeave = () => {
    pointer.target = 0;
  };
  if (!reduceMotion) {
    pointerArea.addEventListener('pointermove', onPointerMove);
    pointerArea.addEventListener('pointerleave', onPointerLeave);
  }

  start();

  // Undoes everything above, for a canvas whose component is unmounting.
  return () => {
    stop();
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    pointerArea.removeEventListener('pointermove', onPointerMove);
    pointerArea.removeEventListener('pointerleave', onPointerLeave);
  };
}
