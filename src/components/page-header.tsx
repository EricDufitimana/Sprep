export interface PageHeaderProps {
  title: string;
  /** One sentence of orientation, not marketing. */
  description?: string;
  /** Right-aligned actions. */
  children?: React.ReactNode;
}

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-h1 font-semibold text-ink-900">{title}</h1>
        {description && <p className="mt-1 text-body text-ink-500">{description}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
