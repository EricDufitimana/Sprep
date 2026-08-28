'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/ui/icon';
import { RichText } from '@/components/rich-text';
import { MathHtml } from '@/components/math-html';

/** Flatten the inline formatting tags for use in a plain-string context (alt). */
function plain(s: string): string {
  return s.replace(/<\/?(?:u|em|strong|sub|sup)>/gi, '');
}

/** A declarative R&W graph is baked to inline HTML (an <svg>/<figure>), not a URL. */
function isRenderedFigure(s: string | null | undefined): boolean {
  return !!s && /<(?:svg|figure|table)\b/i.test(s);
}

export interface QuestionFigureProps {
  /** Public URL of the cropped figure, or null when the question has none. */
  url: string | null | undefined;
  /** Text transcription, used as the alt text and as the fallback if the image fails. */
  description?: string | null;
  className?: string;
}

/**
 * A question's chart/table/diagram.
 *
 * The image is the primary representation; `visual_data` (a text transcription
 * of the figure) is the accessible alternative and the fallback when the image
 * can't load. A chart question is unanswerable without one or the other, so
 * this never renders nothing when there's something to show.
 */
export function QuestionFigure({ url, description, className }: QuestionFigureProps) {
  const [failed, setFailed] = useState(false);

  if (!url && !description) return null;

  // A declarative graph (baked to inline SVG) renders through the same crisp
  // path math uses — real vector, theme-aware, not a rasterised <img>.
  if (!url && isRenderedFigure(description)) {
    return (
      <figure className={cn('my-4', className)}>
        <MathHtml html={description} />
      </figure>
    );
  }

  if (url && !failed) {
    return (
      <figure className={cn('my-4', className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={description ? plain(description) : 'Figure accompanying this question'}
          onError={() => setFailed(true)}
          className="mx-auto max-h-[420px] w-auto max-w-full rounded-control border border-line bg-surface"
        />
      </figure>
    );
  }

  // No image, or it failed to load: show the transcription rather than leaving
  // the question unanswerable.
  if (!description) {
    return (
      <p className={cn('my-4 flex items-center gap-2 rounded-control bg-amber-tint px-3 py-2 text-small text-ink-700', className)}>
        <Icon name="warning" className="text-small" />
        This question has a figure that couldn’t be loaded.
      </p>
    );
  }

  return (
    <figure className={cn('my-4 rounded-control border border-line bg-paper px-4 py-3', className)}>
      <figcaption className="mb-1 text-micro font-medium uppercase tracking-wide text-ink-400">
        Figure
      </figcaption>
      <p className="whitespace-pre-line text-small leading-6 text-ink-700">
        <RichText>{description}</RichText>
      </p>
    </figure>
  );
}
