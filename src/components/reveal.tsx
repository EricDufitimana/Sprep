'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { motion } from '@/lib/tokens';

// useLayoutEffect warns during SSR; fall back to useEffect on the server.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

interface RevealProps {
  children: React.ReactNode;
  /** Stagger direct children instead of animating the wrapper as one block. */
  stagger?: boolean;
  delay?: number;
  className?: string;
}

/**
 * Entrance animation wrapper — fade + small rise, fast, staggered.
 * Fully disabled under prefers-reduced-motion.
 */
export function Reveal({ children, stagger = false, delay = 0, className }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const targets = stagger ? Array.from(el.children) : el;
      gsap.fromTo(
        targets,
        { autoAlpha: 0, y: motion.rise },
        {
          autoAlpha: 1,
          y: 0,
          duration: motion.base,
          ease: motion.ease,
          delay,
          stagger: stagger ? motion.stagger : 0,
          clearProps: 'transform',
        },
      );
    });
    return () => mm.revert();
  }, [stagger, delay]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
