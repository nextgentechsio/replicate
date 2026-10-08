import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

// --------------------------------------------------
// DOWNLOAD PROXY
//
// Streams a Replicate output file back with a download
// filename. This route fetches server-side, so an open
// URL would let callers reach internal hosts (SSRF):
// only Replicate's output CDN is allowed, and every
// redirect hop is re-checked.
//
// It deliberately does NOT accept api.replicate.com
// prediction URLs: those are fetched with our account
// token, so any user could read anyone's prediction.
// Prediction status goes through /api/predictions/[id],
// which checks ownership.
// --------------------------------------------------

const MAX_REDIRECTS = 3;

const TYPES: [string, string, string][] = [
  // [content-type match, url suffix, extension]
  ["video/mp4", ".mp4", "mp4"],
  ["video/webm", ".webm", "webm"],
  ["image/png", ".png", "png"],
  ["image/jpeg", ".jpg", "jpg"],
  ["image/jpeg", ".jpeg", "jpg"],
  ["image/webp", ".webp", "webp"],
  ["image/gif", ".gif", "gif"],
  ["audio/mpeg", ".mp3", "mp3"],
  ["audio/wav", ".wav", "wav"],
];

function isAllowedOutputUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    (url.hostname === "replicate.delivery" ||
      url.hostname.endsWith(".replicate.delivery"))
  );
}

async function fetchAllowedOutput(start: URL): Promise<Response> {
  let current = start;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedOutputUrl(current)) {
      throw new Error("Download source is not allowed");
    }

    const response = await fetch(current, {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
    });

    const location = response.headers.get("location");

    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current);
      continue;
    }

    return response;
  }

  throw new Error("Too many redirects");
}

export async function GET(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const requestedUrl = new URL(request.url).searchParams.get("url");

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(requestedUrl ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (!isAllowedOutputUrl(parsedUrl)) {
    return NextResponse.json(
      { error: "Download source is not allowed" },
      { status: 400 }
    );
  }

  let response: Response;

  try {
    response = await fetchAllowedOutput(parsedUrl);
  } catch (error) {
    console.error("Download proxy error:", error);

    return NextResponse.json(
      { error: "Download source is not allowed" },
      { status: 400 }
    );
  }

  if (!response.ok || !response.body) {
    console.error("Download source error:", response.status);

    return NextResponse.json(
      { error: `Failed to download file (${response.status})` },
      { status: 502 }
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  const path = parsedUrl.pathname.toLowerCase();

  const match = TYPES.find(
    ([type, suffix]) => contentType.includes(type) || path.endsWith(suffix)
  );

  const headers: Record<string, string> = {
    "Content-Type": match?.[0] ?? "application/octet-stream",
    "Content-Disposition": `attachment; filename="generated-output.${match?.[2] ?? "bin"}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };

  // fetch() decompresses, so a compressed upstream length
  // would be wrong for the bytes we send
  const length = response.headers.get("content-length");
  if (length && !response.headers.get("content-encoding")) {
    headers["Content-Length"] = length;
  }

  // Streamed, so large videos aren't held in memory
  return new Response(response.body, { status: 200, headers });
}
