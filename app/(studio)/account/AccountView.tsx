"use client";

import {
  signOut,
  useStudio,
} from "@/app/(studio)/_components/StudioProvider";
import { ROLE_LABELS } from "@/lib/roles";

// --------------------------------------------------
// ACCOUNT
// --------------------------------------------------

export default function AccountView() {
  const { currentUser } = useStudio();

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-fg-subtle">
          Account
        </p>

        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-fg sm:text-[32px]">
          Settings
        </h1>

        <p className="mt-1 text-sm text-fg-muted">Your account.</p>
      </div>

      <div className="grid max-w-xl gap-4 rounded-2xl border border-line bg-surface p-6 sm:grid-cols-3">
        {[
          ["Name", currentUser.name],
          ["Username", `@${currentUser.username}`],
          ["Role", ROLE_LABELS[currentUser.role]],
        ].map(([title, value]) => (
          <div key={title}>
            <p className="text-[10px] uppercase tracking-wider text-fg-subtle">
              {title}
            </p>

            <p className="mt-1 text-sm text-fg">{value}</p>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={signOut}
        className="rounded-xl border border-line-strong px-4 py-2 text-sm text-fg hover:bg-raised"
      >
        Sign out
      </button>
    </div>
  );
}
