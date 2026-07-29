'use client';

import { createContext, useContext, useEffect, useState } from 'react';

/**
 * The SAT section the whole dashboard is currently showing. Chosen from the
 * profile modal, it filters every list (banks, question pool, progress) and
 * switches domain labels/order — the pages are shared, only the data changes.
 *
 * Persisted to localStorage so the choice sticks per browser; there is no DB
 * roundtrip. Individual questions still carry their own `section`/`answer_format`
 * so the test and results screens render correctly regardless of this toggle.
 */
export type Section = 'reading_writing' | 'math';

const STORAGE_KEY = 'sprep:section';

interface SectionContextValue {
  section: Section;
  setSection: (s: Section) => void;
  /** False until localStorage has been read, to avoid a wrong-section flash. */
  ready: boolean;
}

const SectionContext = createContext<SectionContextValue | null>(null);

export function SectionProvider({ children }: { children: React.ReactNode }) {
  const [section, setSectionState] = useState<Section>('reading_writing');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'math' || stored === 'reading_writing') setSectionState(stored);
    setReady(true);
  }, []);

  const setSection = (s: Section) => {
    setSectionState(s);
    window.localStorage.setItem(STORAGE_KEY, s);
  };

  return (
    <SectionContext.Provider value={{ section, setSection, ready }}>
      {children}
    </SectionContext.Provider>
  );
}

export function useSection(): SectionContextValue {
  const ctx = useContext(SectionContext);
  if (!ctx) throw new Error('useSection must be used within a SectionProvider');
  return ctx;
}

export const SECTION_LABELS: Record<Section, string> = {
  reading_writing: 'Reading & Writing',
  math: 'Math',
};
