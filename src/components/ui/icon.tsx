import { cn } from '@/lib/utils';

/**
 * Lineicons wrapper — one icon set, consistently, always through this component.
 * The union type is the roster of icons the app uses; extend it deliberately.
 */
export type IconName =
  | 'home'
  | 'grid-alt'
  | 'book'
  | 'bar-chart'
  | 'timer'
  | 'alarm-clock'
  | 'flag'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'close'
  | 'checkmark'
  | 'checkmark-circle'
  | 'cross-circle'
  | 'plus'
  | 'minus'
  | 'pencil'
  | 'bolt'
  | 'arrow-right'
  | 'arrow-left'
  | 'target'
  | 'graph'
  | 'library'
  | 'question-circle'
  | 'menu'
  | 'angle-double-left'
  | 'cog'
  | 'exit'
  | 'user'
  | 'cloud-upload'
  | 'files'
  | 'trash-can'
  | 'spinner-solid'
  | 'warning'
  | 'calendar'
  | 'reload';

export interface IconProps {
  name: IconName;
  className?: string;
  /** Decorative by default; pass a label when the icon stands alone. */
  label?: string;
}

export function Icon({ name, className, label }: IconProps) {
  return (
    <i
      className={cn(`lni lni-${name}`, className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  );
}
