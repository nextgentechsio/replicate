import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// --------------------------------------------------
// BASIC AUTH FOR THE WHOLE APP
//
// Every page and API route spends the Replicate token,
// so nothing is reachable without APP_USERNAME /
// APP_PASSWORD from .env.local.
// --------------------------------------------------

function safeEqual(a: string, b: string): boolean {
  const first = Buffer.from(a);
  const second = Buffer.from(b);

  if (first.length !== second.length) {
    return false;
  }

  return timingSafeEqual(first, second);
}

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate":
        'Basic realm="AI Studio", charset="UTF-8"',
    },
  });
}

export function proxy(request: NextRequest) {
  const expectedUser = process.env.APP_USERNAME;
  const expectedPassword = process.env.APP_PASSWORD;

  // Fail closed: never run unprotected
  if (!expectedUser || !expectedPassword) {
    return new NextResponse(
      "APP_USERNAME and APP_PASSWORD must be set in .env.local",
      { status: 500 }
    );
  }

  const header =
    request.headers.get("authorization") || "";

  if (!header.startsWith("Basic ")) {
    return unauthorized();
  }

  let decoded = "";

  try {
    decoded = Buffer.from(
      header.slice("Basic ".length),
      "base64"
    ).toString("utf-8");
  } catch {
    return unauthorized();
  }

  const separator = decoded.indexOf(":");

  if (separator < 0) {
    return unauthorized();
  }

  const givenUser = decoded.slice(0, separator);
  const givenPassword = decoded.slice(separator + 1);

  // Evaluate both so timing doesn't reveal which one failed
  const userOk = safeEqual(givenUser, expectedUser);
  const passwordOk = safeEqual(
    givenPassword,
    expectedPassword
  );

  if (!userOk || !passwordOk) {
    return unauthorized();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except build assets. API routes and
    // public/history outputs are intentionally included.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
