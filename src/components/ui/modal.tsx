'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from './icon';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

/** Native <dialog>-based modal: focus trapping, Esc-to-close, backdrop for free. */
export function Modal({ open, onClose, title, children, footer, className }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        // Click on the backdrop (the dialog element itself) closes.
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        'w-full max-w-md rounded-card border border-line bg-surface p-0 shadow-lift',
        'backdrop:bg-ink-900/30',
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="text-h3 font-semibold text-ink-900">{title}</h2>
        <button
          onClick={onClose}
          aria-label="Close dialog"
          className="rounded-control p-1 text-ink-400 transition-colors hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue"
        >
          <Icon name="close" className="text-base" />
        </button>
      </div>
      <div className="px-5 py-4">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>}
    </dialog>
  );
}
