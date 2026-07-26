import { cn } from '@/lib/utils';

/**
 * Three dots that bounce in sequence — a lightweight "…working" indication for
 * optimistic actions (e.g. checking an answer) where a full spinner is overkill.
 * Inherits the current text color so it sits naturally inside a button.
 */
export function LoadingDots({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-[3px]', className)} aria-hidden>
      <span className="h-[3px] w-[3px] rounded-full bg-current animate-bounce [animation-delay:-0.3s]" />
      <span className="h-[3px] w-[3px] rounded-full bg-current animate-bounce [animation-delay:-0.15s]" />
      <span className="h-[3px] w-[3px] rounded-full bg-current animate-bounce" />
    </span>
  );
}
