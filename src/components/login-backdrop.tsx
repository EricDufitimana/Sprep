'use client';

import { useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';
import gsap from 'gsap';

/**
 * The login artwork panel: a soft cream field where SAT skill "pills" drop in
 * under real gravity, pile up, and can be flung around with the cursor — the
 * physics toy from the WeMoveAfrica 404, recoloured to SPrep's dashboard
 * accents. A headline anchored at the bottom stretches toward the cursor and
 * springs back.
 *
 * The pill physics (matter-js) and the headline stretch (GSAP) are two
 * independent readers of the pointer, so they run together without fighting:
 * the canvas is pointer-transparent, the headline sits in a reserved band
 * below where the pills settle, and hovering anywhere — headline included —
 * still flings nearby pills.
 *
 * All motion is gated behind prefers-reduced-motion; with motion off the pills
 * simply sit scattered in place and the headline is inert.
 */

const HEADLINE = 'Know every question\ntype.';

/** The real R&W skills the app trains — the copy is the product. */
const PILLS = [
  'Words in Context',
  'Inferences',
  'Command of Evidence',
  'Transitions',
  'Text Structure',
  'Central Ideas',
  'Boundaries',
  'Rhetorical Synthesis',
  'Cross-Text',
  'Form & Sense',
];

/** The dashboard stat-card accents, at full saturation. */
const PILL_COLORS: { fill: string; text: string }[] = [
  { fill: '#3D6BE0', text: '#FFFFFF' }, // blue
  { fill: '#E86A4F', text: '#FFFFFF' }, // coral
  { fill: '#7C6FDC', text: '#FFFFFF' }, // violet
  { fill: '#3E9E6E', text: '#FFFFFF' }, // green
  { fill: '#E2A63D', text: '#17181C' }, // amber
  { fill: '#F4C33F', text: '#17181C' }, // yolk
  { fill: '#2E9C93', text: '#FFFFFF' }, // teal
  { fill: '#3B9FD9', text: '#FFFFFF' }, // sky
  { fill: '#D6588F', text: '#FFFFFF' }, // pink
  { fill: '#DB7F3D', text: '#FFFFFF' }, // orange
];
/** Deterministic pseudo-random so the static fallback is stable. */
function seeded(i: number) {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function LoginBackdrop() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const headlineWrapRef = useRef<HTMLDivElement>(null);
  // The scattered static pills are the reduced-motion fallback only. Rendering
  // them client-side (never in SSR) sidesteps float/colour hydration mismatch.
  const [showStatic, setShowStatic] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const labelHost = labelsRef.current;
    const headline = headlineRef.current;
    if (!root || !canvas || !labelHost) return;

    const mm = gsap.matchMedia();

    // ---- Headline repel (independent of the pills) -------------------------
    // The cursor parts the headline: letters within RADIUS flee radially away
    // from the pointer — further the closer they are — with a little spin. Each
    // letter is driven by an under-damped spring toward its target, so it
    // overshoots and wobbles both as it's pushed and as it springs back to rest
    // when the cursor leaves.
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const wrap = headlineWrapRef.current;
      const letters = headline
        ? gsap.utils.toArray<HTMLElement>('.lb-letter', headline)
        : [];
      if (!wrap || letters.length === 0) return;

      // Each letter's resting centre, stored as an offset from the wrapper's
      // top-left. Measured with transforms cleared so the maths reads a stable
      // base and never feeds back on itself; re-measured on resize.
      let base: { dx: number; dy: number }[] = [];
      const measure = () => {
        letters.forEach((el) => (el.style.transform = ''));
        const wr = wrap.getBoundingClientRect();
        base = letters.map((el) => {
          const lb = el.getBoundingClientRect();
          return { dx: lb.left + lb.width / 2 - wr.left, dy: lb.top + lb.height / 2 - wr.top };
        });
      };
      measure();

      // Per-letter spring state: current position/rotation, velocity, target.
      const st = letters.map(() => ({ x: 0, y: 0, r: 0, vx: 0, vy: 0, vr: 0, tx: 0, ty: 0, tr: 0 }));

      const RADIUS = 170;
      const PUSH = 72;
      const setTargets = (px: number, py: number) => {
        const wr = wrap.getBoundingClientRect();
        for (let i = 0; i < letters.length; i++) {
          const cx = wr.left + base[i].dx;
          const cy = wr.top + base[i].dy;
          const dx = cx - px;
          const dy = cy - py;
          const dist = Math.hypot(dx, dy) || 1;
          const f = Math.max(0, 1 - dist / RADIUS);
          const ease = f * f; // sharper near the cursor, gentle at the edge
          st[i].tx = (dx / dist) * PUSH * ease;
          st[i].ty = (dy / dist) * PUSH * ease;
          st[i].tr = (dx >= 0 ? 1 : -1) * ease * 26;
        }
      };
      const clearTargets = () => st.forEach((s) => ((s.tx = 0), (s.ty = 0), (s.tr = 0)));

      // Under-damped spring: low stiffness + light damping ⇒ visible overshoot
      // and a couple of wobbles before settling. Tune STIFF↑ / DAMP↓ = springier.
      const STIFF = 0.16;
      const DAMP = 0.8;
      let raf = 0;
      const loop = () => {
        for (let i = 0; i < letters.length; i++) {
          const s = st[i];
          s.vx = (s.vx + (s.tx - s.x) * STIFF) * DAMP;
          s.vy = (s.vy + (s.ty - s.y) * STIFF) * DAMP;
          s.vr = (s.vr + (s.tr - s.r) * STIFF) * DAMP;
          s.x += s.vx;
          s.y += s.vy;
          s.r += s.vr;
          letters[i].style.transform = `translate(${s.x.toFixed(2)}px, ${s.y.toFixed(2)}px) rotate(${s.r.toFixed(2)}deg)`;
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);

      const onMove = (e: PointerEvent) => setTargets(e.clientX, e.clientY);
      const onLeave = () => clearTargets();
      root.addEventListener('pointermove', onMove);
      root.addEventListener('pointerleave', onLeave);
      window.addEventListener('resize', measure);
      return () => {
        cancelAnimationFrame(raf);
        root.removeEventListener('pointermove', onMove);
        root.removeEventListener('pointerleave', onLeave);
        window.removeEventListener('resize', measure);
        letters.forEach((el) => (el.style.transform = ''));
      };
    });

    // ---- Falling, flingable pills (matter-js) ------------------------------
    // Rebuilt on resize so the world always matches the panel's real size.
    let teardown: (() => void) | null = null;

    const build = () => {
      const rect = root.getBoundingClientRect();
      const W = Math.round(rect.width);
      const H = Math.round(rect.height);
      if (W === 0 || H === 0) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;

      // Two floors so the pills split between the copy and the panel floor:
      //   • `ground` spans the full width at the base of the panel
      //   • `shelf` is a narrow platform pinned right onto the centred headline,
      //     only as wide as the copy — pills that drop over it land directly on
      //     the text, while pills to either side slip past and hit the floor.
      // The shelf is capped well under the panel width so there are always clear
      // side lanes down to the floor, on any screen size.
      // The small +4 sinks the shelf into the line-box padding above the glyphs
      // so pills rest against the letters themselves, with no visible gap.
      const h2 = headlineRef.current;
      const h2Rect = h2 ? h2.getBoundingClientRect() : null;
      const shelfY = h2Rect ? Math.round(h2Rect.top - rect.top) + 4 : Math.round(H * 0.5);
      const shelfW = Math.min(
        h2Rect ? Math.round(h2Rect.width) + 24 : Math.round(W * 0.5),
        Math.round(W * 0.6),
      );
      const shelfLeft = W / 2 - shelfW / 2;
      const shelfRight = W / 2 + shelfW / 2;
      const bottomY = H; // floor flush with the panel's bottom edge

      const engine = Matter.Engine.create({ gravity: { y: 1 } });
      const render = Matter.Render.create({
        canvas,
        engine,
        options: {
          width: W,
          height: H,
          pixelRatio: dpr,
          wireframes: false,
          background: 'transparent',
        },
      });

      const staticOpts = {
        isStatic: true,
        render: { fillStyle: 'transparent' },
      };
      // Full-width floor at the base of the panel.
      const ground = Matter.Bodies.rectangle(W / 2, bottomY + 50, W * 2, 100, staticOpts);
      // Narrow, thin shelf sitting on the top edge of the headline. Its top
      // surface is at shelfY; pills whose centre lands over it rest on the copy,
      // pills whose centre is past its edges topple off into the side lanes.
      const shelf = Matter.Bodies.rectangle(W / 2, shelfY + 7, shelfW, 14, {
        ...staticOpts,
        chamfer: { radius: 7 },
      });
      const wallL = Matter.Bodies.rectangle(-55, H / 2, 100, H * 2, staticOpts);
      const wallR = Matter.Bodies.rectangle(W + 55, H / 2, 100, H * 2, staticOpts);
      Matter.Composite.add(engine.world, [ground, shelf, wallL, wallR]);

      const bodies: Matter.Body[] = [];
      const labelEls: HTMLDivElement[] = [];

      // A hidden probe lets us size each pill to its own text.
      const probe = document.createElement('div');
      Object.assign(probe.style, {
        position: 'absolute',
        visibility: 'hidden',
        whiteSpace: 'nowrap',
        fontFamily: "var(--font-sans), system-ui, sans-serif",
        fontSize: '13px',
        fontWeight: '600',
      } as CSSStyleDeclaration);
      labelHost.appendChild(probe);

      const timeouts: ReturnType<typeof setTimeout>[] = [];
      PILLS.forEach((label, i) => {
        timeouts.push(
          setTimeout(() => {
            probe.textContent = label;
            const h = 38;
            const w = Math.ceil(probe.offsetWidth) + 40;
            const color = PILL_COLORS[i % PILL_COLORS.length];

            // Split the drop columns so both piles always appear: even pills fall
            // over the shelf (land on the headline), odd pills fall into a side
            // lane (slip past the copy and reach the floor), alternating sides.
            let spawnX: number;
            if (i % 2 === 0) {
              spawnX = W / 2 + (seeded(i) - 0.5) * shelfW * 0.7;
            } else if (i % 4 === 1) {
              // Left lane: clearly left of the shelf edge, down to the wall.
              spawnX = 40 + seeded(i) * Math.max(10, shelfLeft - 64);
            } else {
              // Right lane.
              spawnX = shelfRight + 24 + seeded(i) * Math.max(10, W - 64 - shelfRight);
            }

            const body = Matter.Bodies.rectangle(
              spawnX,
              -60 - seeded(i + 100) * 340,
              w,
              h,
              {
                restitution: 0.65,
                friction: 0.05,
                frictionAir: 0.01,
                density: 0.001,
                chamfer: { radius: h / 2 },
                render: { fillStyle: color.fill },
              },
            );
            Matter.Composite.add(engine.world, body);
            bodies.push(body);

            const el = document.createElement('div');
            Object.assign(el.style, {
              position: 'absolute',
              left: '0',
              top: '0',
              transformOrigin: 'center',
              fontFamily: 'var(--font-sans), system-ui, sans-serif',
              fontSize: '13px',
              fontWeight: '600',
              letterSpacing: '-0.01em',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              userSelect: 'none',
              color: color.text,
            } as CSSStyleDeclaration);
            el.textContent = label;
            labelHost.appendChild(el);
            labelEls.push(el);
          }, i * 110),
        );
      });

      // Sync the text labels onto their bodies every frame.
      let raf = 0;
      const tick = () => {
        for (let i = 0; i < bodies.length; i++) {
          const { x, y } = bodies[i].position;
          const el = labelEls[i];
          if (el) el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${bodies[i].angle}rad)`;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);

      // Cursor fling — matches the WeMoveAfrica feel.
      const mouse = { x: W / 2, y: -200 };
      const onMouseMove = (e: MouseEvent) => {
        const b = root.getBoundingClientRect();
        mouse.x = e.clientX - b.left;
        mouse.y = e.clientY - b.top;
      };
      const onMouseLeave = () => {
        mouse.x = -1000;
        mouse.y = -1000;
      };
      root.addEventListener('mousemove', onMouseMove);
      root.addEventListener('mouseleave', onMouseLeave);

      const activeRadius = 190;
      Matter.Events.on(engine, 'beforeUpdate', () => {
        for (const b of bodies) {
          const dx = b.position.x - mouse.x;
          const dy = b.position.y - mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < activeRadius && dist > 1) {
            const power = Math.pow(1 - dist / activeRadius, 2);
            Matter.Body.applyForce(b, b.position, {
              x: (dx / dist) * (0.03 * power),
              y: -0.07 * power,
            });
            Matter.Body.setAngularVelocity(b, (Math.random() - 0.5) * 0.4 * power);
          }
        }
      });

      const runner = Matter.Runner.create();
      Matter.Runner.run(runner, engine);
      Matter.Render.run(render);

      teardown = () => {
        timeouts.forEach(clearTimeout);
        cancelAnimationFrame(raf);
        root.removeEventListener('mousemove', onMouseMove);
        root.removeEventListener('mouseleave', onMouseLeave);
        Matter.Render.stop(render);
        Matter.Runner.stop(runner);
        Matter.Events.off(engine, 'beforeUpdate');
        Matter.Engine.clear(engine);
        labelEls.forEach((el) => el.remove());
        probe.remove();
      };
    };

    let physicsActive = false;
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      physicsActive = true;
      build();
      return () => {
        teardown?.();
        teardown = null;
      };
    });

    // Reduced motion: no physics — reveal the static scattered pills instead.
    mm.add('(prefers-reduced-motion: reduce)', () => {
      setShowStatic(true);
      return () => setShowStatic(false);
    });

    // Rebuild on resize (debounced) so the world tracks the panel size.
    let resizeTimer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      if (!physicsActive) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        teardown?.();
        build();
      }, 250);
    };
    window.addEventListener('resize', onResize);

    return () => {
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      mm.revert();
    };
  }, []);

  // Static fallback (also the reduced-motion state): scattered coloured pills.
  const staticLayout = PILLS.map((label, i) => ({
    label,
    left: 8 + seeded(i) * 66,
    top: 10 + seeded(i + 100) * 58,
    rot: (seeded(i + 200) - 0.5) * 16,
    color: PILL_COLORS[i % PILL_COLORS.length],
  }));

  return (
    <div
      ref={rootRef}
      className="relative h-full w-full overflow-hidden"
      style={{ backgroundColor: '#FFFBF1' }}
      aria-hidden="true"
    >
      {/* Soft radial sheen for depth */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 30% 8%, rgba(255,255,255,0.6), transparent 55%)',
        }}
      />

      {/* Physics canvas + its synced text labels (pointer-transparent). */}
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0" />

      {/* Reduced-motion fallback: scattered coloured pills (client-only). */}
      <div className="pointer-events-none absolute inset-0">
        {showStatic &&
          staticLayout.map((p) => (
          <span
            key={p.label}
            className="absolute whitespace-nowrap rounded-pill px-4 py-2 text-small font-semibold shadow-lift"
            style={{
              left: `${p.left}%`,
              top: `${p.top}%`,
              rotate: `${p.rot}deg`,
              backgroundColor: p.color.fill,
              color: p.color.text,
            }}
          >
            {p.label}
          </span>
        ))}
      </div>

      {/* Stretchy headline + tagline, centred in the panel. The pills fall from
          the top and pile up onto this block (the physics ground is pinned to
          its top edge — see build()), so the copy is the shelf the pills land on. */}
      <div
        ref={headlineWrapRef}
        className="absolute inset-x-0 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center px-12 text-center"
      >
        <h2
          ref={headlineRef}
          className="max-w-sm cursor-default select-none text-[2.25rem] font-semibold leading-[1.05] tracking-tight text-ink-900"
        >
          {HEADLINE.split('').map((ch, i) =>
            ch === '\n' ? (
              <br key={i} />
            ) : (
              <span
                key={i}
                className="lb-letter inline-block origin-center"
                style={{ whiteSpace: ch === ' ' ? 'pre' : 'normal' }}
              >
                {ch === ' ' ? ' ' : ch}
              </span>
            ),
          )}
        </h2>
        <p className="mt-3 max-w-sm text-body text-ink-900/70">
          Every Reading &amp; Writing skill, drilled until it stops being a weak spot.
        </p>
      </div>
    </div>
  );
}
