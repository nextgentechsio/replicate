"use client";

import { useEffect, useState } from "react";
import { errorMessage } from "@/lib/client/http";

// Loads data once on mount. `data` stays null until the
// first response; `error` holds a readable message.
// State is only set in the promise callbacks, and
// ignored after unmount.
export function useApiData<T>(
  load: () => Promise<T>,
  fallbackError: string
): { data: T | null; error: string; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    load()
      .then((value) => {
        if (!cancelled) setData(value);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setError(errorMessage(err, fallbackError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Loaders are module-level functions; load once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { data, error, loading };
}
