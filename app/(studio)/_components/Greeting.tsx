"use client";

import { useSyncExternalStore } from "react";

// --------------------------------------------------
// WELCOME GREETING
//
// "Good morning, Uma · Thursday, 8 October", from the
// viewer's own clock. The server can't know that clock,
// so nothing time-based is rendered until the browser
// takes over (no hydration mismatch), and it refreshes
// every minute so it rolls over to the afternoon.
// --------------------------------------------------

function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, 60_000);
  return () => clearInterval(timer);
}

// A string, so React sees "no change" until the hour or
// the day actually changes
function snapshot(): string {
  const now = new Date();
  return `${now.getHours()}|${now.toDateString()}`;
}

function salutation(hour: number) {
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
});

export default function Greeting({ name }: { name: string }) {
  const value = useSyncExternalStore(subscribe, snapshot, () => null);
  const firstName = name.trim().split(/\s+/)[0] || name;

  if (!value) {
    // Same height as the real line, so nothing jumps
    return <p className="h-5" aria-hidden />;
  }

  const [hour, day] = value.split("|");

  return (
    <p className="truncate text-sm text-fg-muted">
      <span className="font-medium text-fg">
        {salutation(Number(hour))}, {firstName}
      </span>
      <span className="text-fg-subtle"> · {DATE_FORMAT.format(new Date(day))}</span>
    </p>
  );
}
