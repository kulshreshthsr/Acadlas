// The hero's record constellation: one student record with its connected records
// (guardian, class, attendance, fees, admission) orbiting it on springs.
// - Drag any card; the links stretch and it springs home.
// - Drag the student and the whole record follows, because every record is attached to it.
// - Tap or press Enter on a card to open its detail.
// - Every few seconds an update travels along a link and the card it reaches refreshes.

type Vec = { x: number; y: number; vx: number; vy: number };

type OrbitNode = {
  el: HTMLElement;
  card: HTMLElement;
  key: string;
  isCenter: boolean;
  fx: number;
  fy: number;
  mfx: number;
  mfy: number;
  depth: number;
  phase: number;
  w: number;
  h: number;
  p: Vec;
  ox: number;
  oy: number;
  appear: number;
  delay: number;
  values: string[];
  valueIndex: number;
  valueEl: HTMLElement | null;
  base?: SVGPathElement;
  flow?: SVGPathElement;
  packet?: SVGCircleElement;
  bend: number;
};

export function mountConstellation(root: HTMLElement, pointerArea: HTMLElement) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const svg = root.querySelector<SVGSVGElement>('[data-orbit-links]');
  if (!svg) return;

  const nodes: OrbitNode[] = [...root.querySelectorAll<HTMLElement>('[data-node]')].map((el, i) => {
    const key = el.dataset.node!;
    const values = el.dataset.values ? (JSON.parse(el.dataset.values) as string[]) : [];
    return {
      el,
      card: el.querySelector<HTMLElement>('.orbit-card')!,
      key,
      isCenter: key === 'center',
      fx: Number(el.dataset.x),
      fy: Number(el.dataset.y),
      mfx: Number(el.dataset.mx ?? el.dataset.x),
      mfy: Number(el.dataset.my ?? el.dataset.y),
      depth: Number(el.dataset.depth ?? 1),
      phase: i * 1.7,
      w: 0,
      h: 0,
      p: { x: 0, y: 0, vx: 0, vy: 0 },
      ox: 0,
      oy: 0,
      appear: reduceMotion ? 1 : 0,
      delay: key === 'center' ? 350 : 700 + i * 140,
      values,
      valueIndex: 0,
      valueEl: el.querySelector<HTMLElement>('[data-value]'),
      bend: i % 2 === 0 ? 1 : -1,
    };
  });

  // The markup positions cards with percentages so the picture holds without JavaScript;
  // from here on the spring simulation owns their position.
  for (const node of nodes) {
    node.el.style.left = '0px';
    node.el.style.top = '0px';
  }

  const center = nodes.find((n) => n.isCenter)!;
  const satellites = nodes.filter((n) => !n.isCenter);

  // One base line, one flowing line and one travelling packet per link.
  const NS = 'http://www.w3.org/2000/svg';
  for (const node of satellites) {
    const base = document.createElementNS(NS, 'path');
    base.setAttribute('fill', 'none');
    base.setAttribute('stroke', 'rgba(111, 207, 204, 0.38)');
    base.setAttribute('stroke-width', '1.25');
    const flow = document.createElementNS(NS, 'path');
    flow.setAttribute('fill', 'none');
    flow.setAttribute('stroke', 'rgba(248, 187, 76, 0.75)');
    flow.setAttribute('stroke-width', '1.5');
    flow.setAttribute('stroke-linecap', 'round');
    flow.setAttribute('stroke-dasharray', '1.5 14');
    const packet = document.createElementNS(NS, 'circle');
    packet.setAttribute('r', '4.5');
    packet.setAttribute('fill', '#f8bb4c');
    packet.style.filter = 'drop-shadow(0 0 6px rgba(248,187,76,0.95))';
    packet.style.opacity = '0';
    svg.append(base, flow, packet);
    Object.assign(node, { base, flow, packet });
  }

  let W = 0;
  let H = 0;
  let mobile = false;

  function measure() {
    const rect = root.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    mobile = W < 560;
    svg!.setAttribute('viewBox', `0 0 ${W} ${H}`);
    for (const node of nodes) {
      node.w = node.el.offsetWidth;
      node.h = node.el.offsetHeight;
    }
    const cfy = mobile ? center.mfy : center.fy;
    for (const node of satellites) {
      setOffsetX(node);
      node.oy = ((mobile ? node.mfy : node.fy) - cfy) * H;
    }
  }

  // Keep every card inside the stage. On narrow phones the cards are wider than their fractional
  // slot allows, so their offsets are pulled in instead of letting them poke past the screen edge.
  // Re-run whenever a card changes width, because its value text changes as the page idles.
  function setOffsetX(node: OrbitNode) {
    const cfx = mobile ? center.mfx : center.fx;
    const homeX = cfx * W;
    const ox = ((mobile ? node.mfx : node.fx) - cfx) * W;
    node.ox = Math.min(Math.max(ox, node.w / 2 - homeX), W - node.w / 2 - homeX);
  }

  function centerHome() {
    return { x: (mobile ? center.mfx : center.fx) * W, y: (mobile ? center.mfy : center.fy) * H };
  }

  function place() {
    const home = centerHome();
    center.p.x = home.x;
    center.p.y = home.y;
    for (const node of satellites) {
      node.p.x = home.x + node.ox;
      node.p.y = home.y + node.oy;
    }
  }

  measure();
  place();

  // ---- Pointer: parallax and dragging -------------------------------------------------
  const parallax = { x: 0, y: 0, tx: 0, ty: 0 };
  if (!reduceMotion) {
    pointerArea.addEventListener('pointermove', (event) => {
      const rect = pointerArea.getBoundingClientRect();
      parallax.tx = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      parallax.ty = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    });
    pointerArea.addEventListener('pointerleave', () => {
      parallax.tx = 0;
      parallax.ty = 0;
    });
  }

  let dragged: OrbitNode | null = null;
  let grab = { x: 0, y: 0 };
  let downAt = { x: 0, y: 0 };
  let moved = false;
  let zTop = 10;

  for (const node of nodes) {
    node.el.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const rect = root.getBoundingClientRect();
      dragged = node;
      moved = false;
      downAt = { x: event.clientX, y: event.clientY };
      grab = { x: event.clientX - rect.left - node.p.x, y: event.clientY - rect.top - node.p.y };
      node.el.setPointerCapture(event.pointerId);
      node.el.style.zIndex = String(++zTop);
      wake();
    });

    node.el.addEventListener('pointermove', (event) => {
      if (dragged !== node) return;
      if (!moved && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 6) {
        moved = true;
        node.el.dataset.dragging = 'true';
        root.dataset.engaged = 'true';
      }
      if (!moved) return;
      const rect = root.getBoundingClientRect();
      const margin = 40;
      const x = Math.min(Math.max(event.clientX - rect.left - grab.x, -margin), W + margin);
      const y = Math.min(Math.max(event.clientY - rect.top - grab.y, -margin), H + margin);
      node.p.vx = x - node.p.x;
      node.p.vy = y - node.p.y;
      node.p.x = x;
      node.p.y = y;
    });

    const release = () => {
      if (dragged !== node) return;
      dragged = null;
      node.el.dataset.dragging = 'false';
    };
    node.el.addEventListener('pointerup', release);
    node.el.addEventListener('pointercancel', release);

    // A click that was really a drag must not toggle the card. Listening on the node, not the
    // button, because pointer capture retargets the click to the element holding the capture.
    node.el.addEventListener('click', (event) => {
      if (moved) {
        event.preventDefault();
        moved = false;
        return;
      }
      const open = node.el.dataset.open !== 'true';
      node.el.dataset.open = String(open);
      node.card.setAttribute('aria-expanded', String(open));
      node.el.style.zIndex = String(++zTop);
      wake();
    });

    new ResizeObserver(() => {
      node.w = node.el.offsetWidth;
      node.h = node.el.offsetHeight;
      if (!node.isCenter) setOffsetX(node);
    }).observe(node.el);
  }

  // ---- Live updates travelling along links ---------------------------------------------
  type Pulse = { node: OrbitNode; start: number; inbound: boolean };
  const pulses: Pulse[] = [];
  let nextPulse = 2600;
  let pulseCursor = 0;
  const pulseOrder = satellites.filter((n) => n.values.length > 1);

  function firePulse(now: number) {
    if (!pulseOrder.length) return;
    const node = pulseOrder[pulseCursor % pulseOrder.length];
    pulseCursor++;
    pulses.push({ node, start: now, inbound: pulseCursor % 2 === 0 });
  }

  function landPulse(node: OrbitNode) {
    node.valueIndex = (node.valueIndex + 1) % node.values.length;
    if (node.valueEl) node.valueEl.textContent = node.values[node.valueIndex];
    node.el.dataset.flash = 'true';
    center.el.dataset.flash = 'true';
    window.setTimeout(() => {
      node.el.dataset.flash = 'false';
      center.el.dataset.flash = 'false';
    }, 900);
  }

  // ---- Geometry helpers ----------------------------------------------------------------
  function curve(node: OrbitNode) {
    const ax = center.p.x;
    const ay = center.p.y;
    const bx = node.p.x;
    const by = node.p.y;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const bend = 0.16 * node.bend;
    const cx = mx - (dy / len) * len * bend;
    const cy = my + (dx / len) * len * bend;
    return { ax, ay, bx, by, cx, cy };
  }

  function pointOn(c: ReturnType<typeof curve>, t: number) {
    const u = 1 - t;
    return {
      x: u * u * c.ax + 2 * u * t * c.cx + t * t * c.bx,
      y: u * u * c.ay + 2 * u * t * c.cy + t * t * c.by,
    };
  }

  // ---- Loop --------------------------------------------------------------------------
  const born = performance.now();
  let raf = 0;
  let running = false;
  let visible = true;
  let idleFrames = 0;

  function step(now: number) {
    const t = now - born;
    parallax.x += (parallax.tx - parallax.x) * 0.06;
    parallax.y += (parallax.ty - parallax.y) * 0.06;

    const home = centerHome();
    const float = reduceMotion ? 0 : 1;
    let energy = 0;

    // Centre node springs to its home unless held.
    if (dragged !== center) {
      const rx = home.x + parallax.x * 10 + Math.sin(t * 0.0007) * 4 * float;
      const ry = home.y + parallax.y * 8 + Math.cos(t * 0.0006) * 5 * float;
      center.p.vx = (center.p.vx + (rx - center.p.x) * 0.05) * 0.8;
      center.p.vy = (center.p.vy + (ry - center.p.y) * 0.05) * 0.8;
      center.p.x += center.p.vx;
      center.p.y += center.p.vy;
    }
    energy += Math.abs(center.p.vx) + Math.abs(center.p.vy);

    // Satellites spring to their offset from wherever the student record is now.
    for (const node of satellites) {
      if (dragged === node) continue;
      const rx = center.p.x + node.ox + parallax.x * 18 * node.depth + Math.sin(t * 0.0009 + node.phase) * 6 * float;
      const ry = center.p.y + node.oy + parallax.y * 14 * node.depth + Math.cos(t * 0.0008 + node.phase) * 7 * float;
      node.p.vx = (node.p.vx + (rx - node.p.x) * 0.045) * 0.84;
      node.p.vy = (node.p.vy + (ry - node.p.y) * 0.045) * 0.84;
      node.p.x += node.p.vx;
      node.p.y += node.p.vy;
      energy += Math.abs(node.p.vx) + Math.abs(node.p.vy);
    }

    // Entrance: cards rise in after the headline, links draw from the student outward.
    for (const node of nodes) {
      if (node.appear < 1) node.appear = Math.min(1, Math.max(0, (t - node.delay) / 650));
      const a = node.appear;
      const eased = 1 - Math.pow(1 - a, 3);
      const scale = 0.85 + eased * 0.15;
      node.el.style.opacity = String(eased);
      node.el.style.transform = `translate3d(${node.p.x - node.w / 2}px, ${node.p.y - node.h / 2}px, 0) scale(${scale})`;
    }

    for (const node of satellites) {
      const c = curve(node);
      const d = `M${c.ax.toFixed(1)},${c.ay.toFixed(1)} Q${c.cx.toFixed(1)},${c.cy.toFixed(1)} ${c.bx.toFixed(1)},${c.by.toFixed(1)}`;
      node.base!.setAttribute('d', d);
      node.flow!.setAttribute('d', d);
      const draw = Math.min(1, Math.max(0, (t - node.delay + 250) / 700));
      if (draw < 1) {
        const len = node.base!.getTotalLength();
        node.base!.style.strokeDasharray = `${len}`;
        node.base!.style.strokeDashoffset = `${len * (1 - draw)}`;
        node.flow!.style.opacity = '0';
      } else {
        node.base!.style.strokeDasharray = '';
        node.base!.style.strokeDashoffset = '';
        node.flow!.style.opacity = '1';
        if (!reduceMotion) node.flow!.style.strokeDashoffset = String(-t * 0.02);
      }
    }

    // Pulses
    if (!reduceMotion && t > nextPulse) {
      firePulse(t);
      nextPulse = t + 2800;
    }
    for (let i = pulses.length - 1; i >= 0; i--) {
      const pulse = pulses[i];
      const k = Math.min(1, (t - pulse.start) / 950);
      const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const pt = pointOn(curve(pulse.node), pulse.inbound ? 1 - ease : ease);
      const circle = pulse.node.packet!;
      circle.setAttribute('cx', pt.x.toFixed(1));
      circle.setAttribute('cy', pt.y.toFixed(1));
      circle.style.opacity = k < 0.08 ? String(k / 0.08) : k > 0.92 ? String((1 - k) / 0.08) : '1';
      if (k >= 1) {
        circle.style.opacity = '0';
        landPulse(pulse.node);
        pulses.splice(i, 1);
      }
    }

    // With motion reduced, stop the loop once everything has settled.
    if (reduceMotion && !dragged && energy < 0.05) idleFrames++;
    else idleFrames = 0;
  }

  function frame(now: number) {
    if (!running) return;
    step(now);
    if (reduceMotion && idleFrames > 30) {
      running = false;
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (running || !visible) return;
    running = true;
    raf = requestAnimationFrame(frame);
  }

  function sleep() {
    running = false;
    cancelAnimationFrame(raf);
  }

  new ResizeObserver(() => {
    const prevW = W;
    measure();
    if (Math.abs(prevW - W) > 1) place();
    wake();
  }).observe(root);

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    visible ? wake() : sleep();
  }).observe(root);

  document.addEventListener('visibilitychange', () => (document.hidden ? sleep() : wake()));

  root.dataset.ready = 'true';
  wake();
}
