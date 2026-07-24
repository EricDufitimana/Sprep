import { cn } from '@/lib/utils';

export type BadgeTone = 'blue' | 'coral' | 'green' | 'amber' | 'miss' | 'neutral';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const tones: Record<BadgeTone, string> = {
  blue: 'bg-blue-tint text-blue',
  coral: 'bg-coral-tint text-coral',
  green: 'bg-green-tint text-green',
  amber: 'bg-amber-tint text-amber',
  miss: 'bg-miss-tint text-miss',
  neutral: 'bg-sunken text-ink-500',
};

export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-micro font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
