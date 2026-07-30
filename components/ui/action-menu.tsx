'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ActionMenuItem = {
  id: string;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  /** Native form action (FormData-only server action). */
  formAction?: (formData: FormData) => void | Promise<void>;
  formFields?: Record<string, string>;
  /** Confirm before submit / select. */
  confirm?: string;
  onSelect?: () => void;
};

type MenuPosition = { top: number; left: number; minWidth: number };

function useMenuPosition(
  open: boolean,
  triggerRef: React.RefObject<HTMLElement | null>,
  align: 'start' | 'end',
) {
  const [pos, setPos] = useState<MenuPosition | null>(null);

  const update = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const minWidth = Math.max(180, rect.width);
    const left =
      align === 'end'
        ? Math.min(rect.right - minWidth, window.innerWidth - minWidth - 8)
        : Math.max(8, rect.left);
    const below = rect.bottom + 6;
    const estimatedHeight = 220;
    const top =
      below + estimatedHeight > window.innerHeight - 8
        ? Math.max(8, rect.top - estimatedHeight - 6)
        : below;
    setPos({ top, left: Math.max(8, left), minWidth });
  }, [align, triggerRef]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, update]);

  return pos;
}

/** Icon-sized ghost button used for row quick actions and menu triggers. */
export const IconActionButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    label: string;
    active?: boolean;
  }
>(function IconActionButton({ label, className, active, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'press inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted',
        'transition-colors duration-150',
        'hover:bg-brand-tint hover:text-brand',
        'focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:pointer-events-none disabled:opacity-40',
        active && 'bg-brand-tint text-brand',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

/**
 * Three-dot overflow menu. Renders the panel in a portal with fixed
 * positioning so it is not clipped by overflow-hidden list cards.
 */
export function ActionMenu({
  label = 'More actions',
  items,
  align = 'end',
  trigger,
  className,
}: {
  label?: string;
  items: ActionMenuItem[];
  align?: 'start' | 'end';
  /** Custom trigger; defaults to ⋯. */
  trigger?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const pos = useMenuPosition(open, triggerRef, align);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    function onPointer(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  return (
    <div className={cn('relative', className)}>
      <IconActionButton
        ref={triggerRef}
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        active={open}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        {trigger ?? <MoreHorizontal className="size-4" strokeWidth={2} aria-hidden />}
      </IconActionButton>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            id={menuId}
            role="menu"
            aria-label={label}
            style={{ top: pos.top, left: pos.left, minWidth: pos.minWidth }}
            className="fixed z-50 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg"
          >
            {items.map((item) => {
              const itemClass = cn(
                'flex w-full items-center px-3 py-2 text-left text-[13px] transition-colors',
                item.destructive
                  ? 'text-red-600 hover:bg-red-50'
                  : 'text-ink hover:bg-canvas',
                item.disabled && 'pointer-events-none opacity-40',
              );

              if (item.formAction) {
                return (
                  <form
                    key={item.id}
                    action={item.formAction}
                    className="block"
                    onSubmit={(event) => {
                      if (item.confirm && !window.confirm(item.confirm)) {
                        event.preventDefault();
                        return;
                      }
                      setOpen(false);
                    }}
                  >
                    {Object.entries(item.formFields ?? {}).map(([name, value]) => (
                      <input key={name} type="hidden" name={name} value={value} />
                    ))}
                    <button
                      type="submit"
                      role="menuitem"
                      disabled={item.disabled}
                      className={itemClass}
                    >
                      {item.label}
                    </button>
                  </form>
                );
              }

              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  className={itemClass}
                  onClick={() => {
                    if (item.confirm && !window.confirm(item.confirm)) return;
                    item.onSelect?.();
                    setOpen(false);
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
