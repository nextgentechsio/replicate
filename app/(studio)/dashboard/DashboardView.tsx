"use client";

import { useStudio } from "@/app/(studio)/_components/StudioProvider";
import { useApiData } from "@/app/(studio)/_components/useApiData";
import { Alert } from "@/app/components/ui/primitives";
import { fetchExpenseReport, fetchGenerations } from "@/lib/client/data";

// --------------------------------------------------
// DASHBOARD
// --------------------------------------------------

function formatUsd4(amount: number | null) {
  return amount === null ? "—" : `$${amount.toFixed(4)}`;
}

export default function DashboardView() {
  const { projects } = useStudio();

  const history = useApiData(fetchGenerations, "Unable to load history.");
  const expenses = useApiData(fetchExpenseReport, "Unable to load expenses.");

  const generations = history.data ?? [];
  const report = expenses.data;

  const total = generations.length;

  const successful = generations.filter(
    (item) => item.status === "succeeded"
  ).length;

  // Spend comes from the MongoDB expense ledger
  const totalSpend = report?.totals.allTime.amountUsd ?? null;
  const todaySpend = report?.totals.today.amountUsd ?? null;

  const projectSpend = projects.map((item) => {
    const group = report?.byProject.find((entry) => entry.id === item.id);

    return {
      name: item.name,
      count: group?.count ?? 0,
      cost: group?.amountUsd ?? 0,
    };
  });

  const error = history.error || expenses.error;

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-fg-subtle">
          Spend
        </p>

        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-fg sm:text-[32px]">
          Dashboard
        </h1>

        <p className="mt-1 text-sm text-fg-muted">
          AI generation workspace overview
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Total Generations", String(total)],
          ["Total Spend", formatUsd4(totalSpend)],
          ["Today", formatUsd4(todaySpend)],
          [
            "Success Rate",
            total ? `${Math.round((successful / total) * 100)}%` : "—",
          ],
        ].map(([title, value]) => (
          <div
            key={title}
            className="rounded-2xl border border-line bg-surface p-5"
          >
            <p className="text-xs uppercase tracking-wider text-fg-subtle">
              {title}
            </p>

            <p className="mt-4 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-semibold">Recent generations</h2>

          <div className="mt-5 space-y-3">
            {generations.slice(0, 5).map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-xl bg-sunken p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-fg">{item.model}</p>

                  <p className="mt-1 text-xs text-fg-subtle">
                    {item.project} · {item.user}
                  </p>
                </div>

                <span className="text-xs text-fg-muted">
                  {formatUsd4(item.costUsd)}
                </span>
              </div>
            ))}

            {!history.loading && !generations.length && (
              <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-fg-subtle">
                No generation history yet.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-semibold">Project usage</h2>

          <div className="mt-5 space-y-3">
            {projectSpend.map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between rounded-xl bg-sunken px-4 py-3"
              >
                <div>
                  <span className="text-sm text-fg-muted">{item.name}</span>

                  <span className="ml-2 text-xs text-fg-subtle">
                    {item.count} generations
                  </span>
                </div>

                <span className="text-xs text-fg-muted">
                  {formatUsd4(item.cost)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
