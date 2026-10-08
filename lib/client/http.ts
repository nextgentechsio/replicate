// --------------------------------------------------
// FETCH HELPER (browser only)
//
// Reads JSON defensively: an empty or non-JSON body
// (a crashed route, a proxy error page) becomes a
// readable Error instead of a JSON parse crash. A 401
// means the session ended, so go back to sign-in and
// return here afterwards.
// --------------------------------------------------

export async function fetchJson<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
  });

  const text = await response.text();

  let data: unknown = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Unexpected response from the server (${response.status})`
    );
  }

  if (response.status === 401) {
    const here = window.location.pathname + window.location.search;

    // Full reload on purpose: the session is gone, so no
    // client state should survive
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(
      `/login?next=${encodeURIComponent(here)}`
    );

    throw new Error("Your session has ended. Please sign in again.");
  }

  if (!response.ok) {
    throw new Error(
      (data as { error?: string }).error ||
        `Request failed (${response.status})`
    );
  }

  return data as T;
}

export function errorMessage(
  error: unknown,
  fallback: string
): string {
  return error instanceof Error && error.message
    ? error.message
    : fallback;
}
