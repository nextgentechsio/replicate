"use client";

import { useState } from "react";

// Only allow same-origin relative paths, so ?next= can't
// be used as an open redirect.
function safeNextPath(): string {
  const next = new URLSearchParams(
    window.location.search
  ).get("next");

  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.startsWith("/\\")
  ) {
    return "/";
  }

  return next;
}

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Login failed");
      }

      window.location.assign(safeNextPath());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Login failed"
      );
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#09090b] px-5 text-white">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-sm font-bold text-black">
            AI
          </div>

          <div>
            <p className="text-sm font-semibold">
              AI Studio
            </p>

            <p className="text-[10px] text-zinc-600">
              Sign in to continue
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="username"
            className="text-sm text-zinc-300"
          >
            Username
          </label>

          <input
            id="username"
            value={username}
            onChange={(event) =>
              setUsername(event.target.value)
            }
            autoComplete="username"
            autoFocus
            required
            className="h-11 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm outline-none focus:border-zinc-500"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="password"
            className="text-sm text-zinc-300"
          >
            Password
          </label>

          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) =>
              setPassword(event.target.value)
            }
            autoComplete="current-password"
            required
            className="h-11 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm outline-none focus:border-zinc-500"
          />
        </div>

        {error && (
          <div className="rounded-xl border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="flex h-11 w-full items-center justify-center rounded-xl bg-white text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}
