"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { Icon, type IconName } from "@/app/components/ui/Icon";
import { cx } from "@/app/components/ui/primitives";

// --------------------------------------------------
// THEME TOGGLE: System / Light / Dark
//
// "system" removes data-theme so CSS follows the OS.
// The inline script in layout.tsx applies the saved
// choice before first paint.
// --------------------------------------------------

type ThemeChoice = "system" | "light" | "dark";

const OPTIONS: {
  value: ThemeChoice;
  icon: IconName;
  label: string;
}[] = [
  { value: "system", icon: "monitor", label: "System theme" },
  { value: "light", icon: "sun", label: "Light theme" },
  { value: "dark", icon: "moon", label: "Dark theme" },
];

function readStoredTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem("theme");
    return value === "light" || value === "dark"
      ? value
      : "system";
  } catch {
    return "system";
  }
}

function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;

  if (choice === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", choice);
  }
}

// The saved choice is browser-only state: read it via
// useSyncExternalStore so the server render ("system")
// and hydration agree, then switch to the real value.
const THEME_EVENT = "themechange";

function subscribe(onChange: () => void) {
  // Another tab changed the theme: repaint this one too,
  // not just the toggle
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== "theme") return;
    applyTheme(readStoredTheme());
    onChange();
  };

  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export default function ThemeToggle() {
  const choice = useSyncExternalStore<ThemeChoice>(
    subscribe,
    readStoredTheme,
    () => "system"
  );

  // Re-apply after React's dev-mode remount resets <html>
  // attributes (no-op in production).
  useLayoutEffect(() => {
    applyTheme(readStoredTheme());
  }, []);

  function select(next: ThemeChoice) {
    try {
      if (next === "system") {
        localStorage.removeItem("theme");
      } else {
        localStorage.setItem("theme", next);
      }
    } catch {
      // Storage unavailable: theme still applies for now
    }

    applyTheme(next);
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className="flex items-center gap-0.5 rounded-lg border border-line bg-sunken p-0.5"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={choice === option.value}
          aria-label={option.label}
          title={option.label}
          onClick={() => select(option.value)}
          className={cx(
            "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
            choice === option.value
              ? "bg-surface text-fg shadow-card"
              : "text-fg-subtle hover:text-fg"
          )}
        >
          <Icon name={option.icon} size={15} />
        </button>
      ))}
    </div>
  );
}
