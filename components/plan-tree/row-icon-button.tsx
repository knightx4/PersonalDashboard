import { IconButton } from '@/components/ui/icon-button';

/**
 * One of the row's quick actions, on the dev plan and a goal's steps alike.
 *
 * An icon on the row rather than a button behind the fold: sending a step to
 * Dash, handing it over and editing it are the three things done to a step
 * without needing to read it first, and reaching them through the step's own
 * detail made every one of them two clicks and a scroll.
 */
export function RowIconButton({
  label,
  type = 'button',
  pending = false,
  onClick,
  children,
}: {
  label: string;
  type?: 'button' | 'submit';
  pending?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <IconButton type={type} label={label} onClick={onClick} disabled={pending}>
      {children}
    </IconButton>
  );
}
