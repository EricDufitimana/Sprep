'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * Signature button: flat confident fill, crisp border, and a solid offset
 * "plate" underneath. Hover lifts one notch; press drops the button onto its
 * plate. Every variant shares the same tactile mechanism — the personality
 * lives in the press.
 */

export type ButtonVariant = 'primary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const base =
  'inline-flex items-center justify-center gap-2 rounded-control border font-medium select-none ' +
  'transition-[transform,box-shadow,background-color] duration-150 ease-out ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2 focus-visible:ring-offset-paper ' +
  'disabled:pointer-events-none disabled:opacity-45 ' +
  'motion-safe:hover:-translate-y-px motion-safe:active:translate-y-[3px]';

const variants: Record<ButtonVariant, string> = {
  primary: cn(
    'bg-blue text-white border-blue-deep',
    'shadow-[0_3px_0_0_theme(colors.blue.deep)]',
    'hover:bg-blue/95 motion-safe:hover:shadow-[0_4px_0_0_theme(colors.blue.deep)]',
    'active:shadow-none active:bg-blue-deep',
  ),
  // Secondary action: a quiet light surface, so it never competes with primary.
  ghost: cn(
    'bg-surface text-ink-700 border-line',
    'shadow-[0_3px_0_0_theme(colors.line)]',
    'hover:bg-paper hover:text-ink-900 motion-safe:hover:shadow-[0_4px_0_0_theme(colors.line)]',
    'active:shadow-none active:bg-sunken',
  ),
  danger: cn(
    'bg-miss text-white border-miss-deep',
    'shadow-[0_3px_0_0_theme(colors.miss.deep)]',
    'hover:bg-miss/95 motion-safe:hover:shadow-[0_4px_0_0_theme(colors.miss.deep)]',
    'active:shadow-none active:bg-miss-deep',
  ),
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-small',
  md: 'h-10 px-4 text-body',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
