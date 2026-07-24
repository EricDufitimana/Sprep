'use client';

import { forwardRef, useId } from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, hint, className, id: idProp, ...props }, ref) => {
    const autoId = useId();
    const id = idProp ?? autoId;
    return (
      <div className={className}>
        {label && (
          <label htmlFor={id} className="mb-1.5 block text-small font-medium text-ink-700">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          className={cn(
            'h-10 w-full rounded-control border border-line bg-surface px-3 text-body text-ink-900',
            'placeholder:text-ink-400',
            'focus:outline-none focus:ring-2 focus:ring-blue focus:border-blue',
            'disabled:opacity-45',
          )}
          {...props}
        />
        {hint && <p className="mt-1 text-micro text-ink-400">{hint}</p>}
      </div>
    );
  },
);
Input.displayName = 'Input';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, className, id: idProp, ...props }, ref) => {
    const autoId = useId();
    const id = idProp ?? autoId;
    return (
      <div className={className}>
        {label && (
          <label htmlFor={id} className="mb-1.5 block text-small font-medium text-ink-700">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={id}
          className={cn(
            'w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink-900',
            'placeholder:text-ink-400',
            'focus:outline-none focus:ring-2 focus:ring-blue focus:border-blue',
          )}
          {...props}
        />
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';
