import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  isSessionConfigured,
  SESSION_COOKIE,
  verifySessionToken,
} from "@/lib/session";

// --------------------------------------------------
// SESSION GATE FOR THE WHOLE APP
//
// Optimistic check only (cookie signature + expiry).
// Route handlers do the authoritative check via
// requireUser() in lib/auth.ts, which also catches
// disabled users and revoked sessions.
// --------------------------------------------------

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
]);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // Fail closed: never run unprotected
  if (!isSessionConfigured()) {
    return new NextResponse(
      "SESSION_SECRET (32+ characters) must be set in .env.local",
      { status: 500 }
    );
  }

  const session = verifySessionToken(
    request.cookies.get(SESSION_COOKIE)?.value
  );

  if (PUBLIC_PATHS.has(pathname)) {
    // Already signed in: skip the login page
    if (session && pathname === "/login") {
      return NextResponse.redirect(
        new URL("/", request.url)
      );
    }

    return NextResponse.next();
  }

  if (session) {
    return NextResponse.next();
  }

  if (isApi) {
    return NextResponse.json(
      { error: "Not signed in" },
      { status: 401 }
    );
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname + search);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Everything except build assets. API routes and
    // public/history outputs are intentionally included.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
