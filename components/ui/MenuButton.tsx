"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

interface MenuButtonProps {
  /** Visible button content. */
  children: React.ReactNode;
  /** Accessible name of the button. */
  label: string;
  items: MenuItem[];
  disabled?: boolean;
  title?: string;
  className?: string;
  align?: "start" | "end";
}

/**
 * A button that opens a menu. The menu renders in a portal (so scrolling toolbars don't clip it)
 * and supports arrow keys, Home/End, Escape and outside clicks.
 */
export default function MenuButton({ children, label, items, disabled, title, className, align = "start" }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const menuWidth = menuRef.current?.offsetWidth ?? 200;
    const left = align === "end" ? rect.right - menuWidth : rect.left;
    setPosition({ top: rect.bottom + 4, left: Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8)) });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const firstEnabled = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
    firstEnabled?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close(false);
    };
    const onResize = () => close(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close]);

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
    const index = nodes.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      nodes[(index + 1) % nodes.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      nodes[(index - 1 + nodes.length) % nodes.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      nodes[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      nodes[nodes.length - 1]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title={title ?? label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={className}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKeyDown}
            className="fixed z-50 min-w-48 rounded-lg border border-neutral-200 bg-white py-1 shadow-lg"
            style={{ top: position?.top ?? -9999, left: position?.left ?? -9999 }}
          >
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm outline-none hover:bg-neutral-100 focus:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 ${
                  item.danger ? "text-red-600" : "text-neutral-800"
                }`}
              >
                {item.icon && <span className="flex w-4 justify-center text-neutral-500">{item.icon}</span>}
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
