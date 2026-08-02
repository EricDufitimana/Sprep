'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The Desmos graphing calculator, embedded the way the real Bluebook exam gives
 * it to you on the math section. It sits in its own pane beside the question so
 * you can graph, scratch, and check as you work.
 *
 * State is persisted to localStorage under `storageKey`, so your expressions and
 * graphs survive navigating between questions, closing/reopening the panel, and
 * even a full page reload — you always come back to exactly what you had.
 *
 * The Desmos API is loaded once from their CDN with the public demo API key. If
 * it can't load (e.g. offline), the pane shows a plain message instead of an
 * empty box.
 */

// Desmos exposes a single global constructor. We only touch the handful of
// methods we use, so a minimal structural type keeps us honest without pulling
// in the full (untyped) API surface.
interface DesmosCalculatorInstance {
  getState(): unknown;
  setState(state: unknown): void;
  observeEvent(event: string, cb: () => void): void;
  destroy(): void;
}
interface DesmosGlobal {
  GraphingCalculator(el: HTMLElement, options?: Record<string, unknown>): DesmosCalculatorInstance;
}
declare global {
  interface Window {
    Desmos?: DesmosGlobal;
  }
}

// Desmos's documented public demo API key. Swap for a registered key (free at
// desmos.com/api) before any public deployment.
const DESMOS_SRC =
  'https://www.desmos.com/api/v1.11/calculator.js?apiKey=dcb31709b452b1cf9dc26972add0fda6';

let scriptPromise: Promise<DesmosGlobal> | null = null;

/** Load the Desmos API exactly once, no matter how many calculators mount. */
function loadDesmos(): Promise<DesmosGlobal> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.Desmos) return Promise.resolve(window.Desmos);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<DesmosGlobal>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${DESMOS_SRC}"]`);
    const onReady = () => (window.Desmos ? resolve(window.Desmos) : reject(new Error('Desmos missing')));
    if (existing) {
      existing.addEventListener('load', onReady);
      existing.addEventListener('error', () => reject(new Error('Desmos failed to load')));
      return;
    }
    const script = document.createElement('script');
    script.src = DESMOS_SRC;
    script.async = true;
    script.onload = onReady;
    script.onerror = () => {
      scriptPromise = null; // let a later mount retry
      reject(new Error('Desmos failed to load'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function DesmosCalculator({
  storageKey,
  className,
}: {
  /** localStorage key its expressions/graph state persist under. */
  storageKey: string;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let calc: DesmosCalculatorInstance | null = null;
    let cancelled = false;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    loadDesmos()
      .then((Desmos) => {
        if (cancelled || !hostRef.current) return;
        calc = Desmos.GraphingCalculator(hostRef.current, {
          // Match Bluebook: no branding/settings chrome, keypad available.
          keypad: true,
          expressions: true,
          settingsMenu: false,
          border: false,
          lockViewport: false,
        });

        // Restore whatever was last on the graph.
        try {
          const raw = localStorage.getItem(storageKey);
          if (raw) calc.setState(JSON.parse(raw));
        } catch {
          /* corrupt/absent state — start fresh */
        }

        // Persist on every change, debounced so dragging a slider isn't a write storm.
        calc.observeEvent('change', () => {
          if (saveTimer) clearTimeout(saveTimer);
          saveTimer = setTimeout(() => {
            try {
              localStorage.setItem(storageKey, JSON.stringify(calc?.getState()));
            } catch {
              /* storage full/blocked — non-fatal */
            }
          }, 400);
        });

        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
      if (saveTimer) clearTimeout(saveTimer);
      calc?.destroy();
    };
  }, [storageKey]);

  return (
    <div className={className} style={{ position: 'relative' }}>
      <div ref={hostRef} className="h-full w-full" />
      {status !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center bg-white text-[13px] text-[#6B6559]">
          {status === 'loading' ? 'Loading calculator…' : 'Calculator unavailable — check your connection.'}
        </div>
      )}
    </div>
  );
}
