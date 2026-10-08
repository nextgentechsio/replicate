"use client";

import { useState } from "react";
import { useStudio } from "@/app/(studio)/_components/StudioProvider";
import { useApiData } from "@/app/(studio)/_components/useApiData";
import { Alert } from "@/app/components/ui/primitives";
import { fetchGenerations } from "@/lib/client/data";
import { errorMessage } from "@/lib/client/http";
import { downloadOutput, getOutputType } from "@/lib/client/outputs";
import { canManageUsers } from "@/lib/roles";

// --------------------------------------------------
// HISTORY PAGE
//
// Loading /api/generations also finishes runs whose tab
// closed mid-way (server-side reconcile).
// --------------------------------------------------

export default function HistoryView() {
  const { currentUser } = useStudio();

  const { data, error, loading } = useApiData(
    fetchGenerations,
    "Unable to load history."
  );

  const [downloadError, setDownloadError] = useState("");

  const history = data ?? [];

  function download(url: string, predictionId: string) {
    setDownloadError("");

    downloadOutput(url, `generation-${predictionId}`).catch((err) => {
      console.error("DOWNLOAD ERROR:", err);
      setDownloadError(errorMessage(err, "Download failed"));
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-fg-subtle">
          Library
        </p>

        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-fg sm:text-[32px]">
          Generation History
        </h1>

        <p className="mt-1 text-sm text-fg-muted">
          {canManageUsers(currentUser)
            ? "Every generation across the workspace."
            : "Your generations."}
        </p>
      </div>

      {(error || downloadError) && <Alert>{error || downloadError}</Alert>}

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        {loading ? (
          <div className="p-12 text-center text-sm text-fg-subtle">
            Loading history...
          </div>
        ) : !history.length ? (
          <div className="p-12 text-center text-sm text-fg-subtle">
            No generation history yet.
          </div>
        ) : (
          <div className="divide-y divide-line">
            {history.map((item) => (
              <div
                key={item.id}
                className="grid gap-4 p-5 md:grid-cols-[120px_1fr_auto]"
              >
                <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-xl bg-black">
                  {item.outputUrl ? (
                    getOutputType(item.outputUrl) === "video" ? (
                      <video
                        src={item.outputUrl}
                        className="h-full w-full object-cover"
                        controls
                        muted
                        playsInline
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.outputUrl}
                        alt="Generated output"
                        className="h-full w-full object-cover"
                      />
                    )
                  ) : (
                    <span className="text-xs text-fg-subtle">
                      {item.status === "succeeded" ? "No image" : item.status}
                    </span>
                  )}
                </div>

                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">
                    {item.model}
                  </p>

                  <p className="mt-1 text-xs text-fg-muted">
                    {item.project} · {item.user}
                  </p>

                  <p className="mt-3 line-clamp-2 text-sm text-fg-muted">
                    {item.prompt || "No prompt"}
                  </p>

                  <p className="mt-3 text-[11px] text-fg-subtle">
                    {new Date(item.createdAt).toLocaleString()} ·{" "}
                    {item.predictionId}
                  </p>
                </div>

                <div className="flex min-w-28 flex-col items-end justify-between gap-3">
                  <div className="text-right">
                    <p className="text-sm text-fg">
                      {item.costUsd == null
                        ? "—"
                        : `$${item.costUsd.toFixed(4)}`}
                    </p>

                    <p className="mt-1 text-[10px] uppercase text-fg-subtle">
                      {item.status}
                    </p>
                  </div>

                  {item.outputUrl && (
                    <button
                      type="button"
                      onClick={() =>
                        download(item.outputUrl!, item.predictionId)
                      }
                      className="rounded-lg border border-line-strong px-3 py-2 text-xs text-fg hover:bg-raised"
                    >
                      Download
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
