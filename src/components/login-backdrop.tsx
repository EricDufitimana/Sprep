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

const HEADLINE = 'Know every question type.';

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

    // ---- Headline stretch (independent of the pills) -----------------------
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const letters = headline
        ? gsap.utils.toArray<HTMLElement>('.lb-letter', headline)
        : [];
      const setters = letters.map((el) => ({
        sx: gsap.quickTo(el, 'scaleX', { duration: 0.4, ease: 'power3' }),
        x: gsap.quickTo(el, 'x', { duration: 0.4, ease: 'power3' }),
        y: gsap.quickTo(el, 'y', { duration: 0.4, ease: 'power3' }),
      }));

      const onMove = (e: PointerEvent) => {
        if (!headline) return;
        const hb = headline.getBoundingClientRect();
        const px = e.clientX;
        letters.forEach((el, i) => {
          const lb = el.getBoundingClientRect();
          const cx = lb.left + lb.width / 2;
          const falloff = Math.max(0, 1 - Math.abs(px - cx) / 220);
          setters[i].sx(1 + falloff * 0.9);
          setters[i].x((px > cx ? -1 : 1) * falloff * 6);
          setters[i].y(-falloff * (e.clientY < hb.top + hb.height / 2 ? 4 : -4));
        });
      };
      const onLeave = () =>
        letters.forEach((el) =>
          gsap.to(el, { scaleX: 1, x: 0, y: 0, duration: 0.9, ease: 'elastic.out(1, 0.35)' }),
        );

      root.addEventListener('pointermove', onMove);
      root.addEventListener('pointerleave', onLeave);
      return () => {
        root.removeEventListener('pointermove', onMove);
        root.removeEventListener('pointerleave', onLeave);
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

      // Reserve the bottom band for the headline so pills settle above it.
      const groundY = H - 168;

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
      const ground = Matter.Bodies.rectangle(W / 2, groundY + 50, W * 2, 100, staticOpts);
      const wallL = Matter.Bodies.rectangle(-55, H / 2, 100, H * 2, staticOpts);
      const wallR = Matter.Bodies.rectangle(W + 55, H / 2, 100, H * 2, staticOpts);
      Matter.Composite.add(engine.world, [ground, wallL, wallR]);

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

            const body = Matter.Bodies.rectangle(
              W / 2 + (seeded(i) - 0.5) * (W * 0.6),
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

      {/* Stretchy headline + tagline, anchored bottom-left in the reserved band. */}
      <div className="absolute inset-x-0 bottom-0 z-10 p-12">
        <h2
          ref={headlineRef}
          className="max-w-md cursor-default select-none text-[2.75rem] font-semibold leading-[1.05] tracking-tight text-ink-900"
        >
          {HEADLINE.split('').map((ch, i) => (
            <span
              key={i}
              className="lb-letter inline-block origin-left"
              style={{ whiteSpace: ch === ' ' ? 'pre' : 'normal' }}
            >
              {ch === ' ' ? ' ' : ch}
            </span>
          ))}
        </h2>
        <p className="mt-3 max-w-sm text-body text-ink-900/70">
          Every Reading &amp; Writing skill, drilled until it stops being a weak spot.
        </p>
      </div>
    </div>
  );
}
