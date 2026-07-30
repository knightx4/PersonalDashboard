'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
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

function buildFormData(fields: Record<string, string> | undefined): FormData {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields ?? {})) {
    formData.set(name, value);
  }
  return formData;
}

/** Icon-sized ghost button used for row quick actions and menu triggers. */
export const IconActionButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    label: string;
    active?: boolean;
  }
>(function IconActionButton({ label, className, active, children, type = 'button', ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
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
 *
 * Server actions are invoked via startTransition after the menu closes —
 * unmounting a <form> mid-submit was aborting deletes / excludes.
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
  const [pending, startTransition] = useTransition();
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

  function runItem(item: ActionMenuItem) {
    if (item.disabled || pending) return;
    if (item.confirm && !window.confirm(item.confirm)) return;

    setOpen(false);

    if (item.formAction) {
      const formData = buildFormData(item.formFields);
      const action = item.formAction;
      startTransition(() => {
        void action(formData);
      });
      return;
    }

    item.onSelect?.();
  }

  return (
    <div className={cn('relative', className)}>
      <IconActionButton
        ref={triggerRef}
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        active={open}
        disabled={pending}
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
                (item.disabled || pending) && 'pointer-events-none opacity-40',
              );

              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled || pending}
                  className={itemClass}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    runItem(item);
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
