import { NextResponse } from "next/server";
import {
  createSessionToken,
  isSessionConfigured,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/session";
import {
  hasAnyUsers,
  toPublicUser,
  verifyCredentials,
} from "@/lib/users";

export const runtime = "nodejs";

// --------------------------------------------------
// LOGIN THROTTLE (in-memory, per username)
//
// Keyed on username only: x-forwarded-for is client
// controlled, so including it would let an attacker
// reset the counter by rotating the header.
// --------------------------------------------------

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

const failures = new Map<
  string,
  { count: number; firstAt: number }
>();

function throttleKey(username: unknown) {
  return String(username ?? "")
    .trim()
    .toLowerCase();
}

function isThrottled(key: string): boolean {
  const entry = failures.get(key);

  if (!entry) return false;

  if (Date.now() - entry.firstAt > WINDOW_MS) {
    failures.delete(key);
    return false;
  }

  return entry.count >= MAX_FAILURES;
}

function recordFailure(key: string) {
  const entry = failures.get(key);

  if (!entry || Date.now() - entry.firstAt > WINDOW_MS) {
    failures.set(key, { count: 1, firstAt: Date.now() });
    return;
  }

  entry.count += 1;
}

export async function POST(request: Request) {
  try {
    if (!isSessionConfigured()) {
      return NextResponse.json(
        {
          error:
            "SESSION_SECRET (32+ characters) is missing in .env.local",
        },
        { status: 500 }
      );
    }

    if (!(await hasAnyUsers())) {
      return NextResponse.json(
        {
          error:
            "No users exist yet. Set SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD in .env.local and restart.",
        },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { username, password } = body ?? {};

    const key = throttleKey(username);

    if (isThrottled(key)) {
      return NextResponse.json(
        {
          error:
            "Too many failed attempts. Try again in 15 minutes.",
        },
        { status: 429 }
      );
    }

    const user = await verifyCredentials(
      username,
      password
    );

    if (!user) {
      recordFailure(key);

      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      );
    }

    failures.delete(key);

    const response = NextResponse.json({
      success: true,
      user: toPublicUser(user),
    });

    response.cookies.set(
      SESSION_COOKIE,
      createSessionToken(user.id, user.sessionVersion),
      {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: SESSION_MAX_AGE_SECONDS,
      }
    );

    return response;
  } catch (error) {
    console.error("Login error:", error);

    return NextResponse.json(
      { error: "Login failed" },
      { status: 500 }
    );
  }
}
