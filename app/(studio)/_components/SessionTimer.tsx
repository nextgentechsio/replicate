"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "@/app/components/ui/Icon";

// --------------------------------------------------
// SESSION TIMER
//
// How long this session has been signed in, ticking
// every second ("01:24:07"). Survives refreshes: the
// start time comes from the session cookie. Rendered
// only in the browser (the server's clock render would
// never match the client's), with a same-size
// placeholder so nothing shifts.
// --------------------------------------------------

function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, 1000);
  return () => clearInterval(timer);
}

const pad = (value: number) => String(value).padStart(2, "0");

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  // Sessions last up to 7 days
  if (hours >= 24) {
    return `${Math.floor(hours / 24)}d ${pad(hours % 24)}:${pad(minutes)}:${pad(seconds)}`;
  }

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

const SIGNED_IN_AT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

export default function SessionTimer({ startedAt }: { startedAt: number }) {
  // A string snapshot: re-renders once per second
  const elapsed = useSyncExternalStore(
    subscribe,
    () => formatElapsed(Date.now() - startedAt),
    () => null
  );

  return (
    <div
      className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-fg-muted"
      title={`Signed in ${SIGNED_IN_AT.format(new Date(startedAt))}`}
    >
      <Icon name="clock" size={14} className="text-brand" />
      <span className="hidden sm:inline">Session</span>
      {/* role=timer is polite by default: not read out
          every second */}
      <span
        role="timer"
        aria-label="Time signed in"
        className="min-w-[4.25rem] font-mono font-medium tabular-nums text-fg"
      >
        {elapsed ?? "--:--:--"}
      </span>
    </div>
  );
}
