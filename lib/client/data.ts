import { fetchJson } from "@/lib/client/http";
import type { ExpenseReport } from "@/lib/expenses";
import type {
  HistoryPage,
  HistoryStatus,
  PublicGeneration,
} from "@/lib/generations";
import type { PublicProject } from "@/lib/roles";

// --------------------------------------------------
// API READERS (browser only)
//
// The server scopes every list: users get their own
// generations and spend, admins and the super admin
// get the whole workspace.
// --------------------------------------------------

export type {
  HistoryPage,
  HistoryStatus,
  PublicGeneration,
} from "@/lib/generations";

export type HistoryFilters = {
  page?: number;
  pageSize?: number;
  project?: string;
  user?: string;
  model?: string;
  status?: HistoryStatus;
  q?: string;
};

export type GenerationDetail = PublicGeneration & {
  inputs: Record<string, unknown>;
};

export async function fetchActiveProjects(): Promise<PublicProject[]> {
  const data = await fetchJson<{ projects?: PublicProject[] }>(
    "/api/projects"
  );

  return data.projects ?? [];
}

export function historyQueryString(filters: HistoryFilters): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "" && value !== null) {
      params.set(key, String(value));
    }
  }

  return params.toString();
}

export function fetchHistoryPage(
  filters: HistoryFilters = {}
): Promise<HistoryPage> {
  return fetchJson<HistoryPage>(
    `/api/generations?${historyQueryString(filters)}`
  );
}

export async function fetchGeneration(id: string): Promise<GenerationDetail> {
  const data = await fetchJson<{ generation: GenerationDetail }>(
    `/api/generations/${encodeURIComponent(id)}`
  );

  return data.generation;
}

// Totals are aggregated on the server; we only send the
// viewer's local midnights so "today", "this week" and
// "this month" match their timezone.
export function fetchExpenseReport(): Promise<ExpenseReport> {
  const now = new Date();

  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  const weekStart = new Date(todayStart);
  weekStart.setDate(todayStart.getDate() - todayStart.getDay());

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const params = new URLSearchParams({
    todayStart: todayStart.toISOString(),
    weekStart: weekStart.toISOString(),
    monthStart: monthStart.toISOString(),
  });

  return fetchJson<ExpenseReport>(`/api/expenses?${params}`);
}
