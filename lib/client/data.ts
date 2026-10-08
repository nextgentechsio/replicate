import { fetchJson } from "@/lib/client/http";
import type { ExpenseReport } from "@/lib/expenses";
import type { PublicProject } from "@/lib/roles";

// --------------------------------------------------
// API READERS (browser only)
//
// The server scopes every list: users get their own
// generations and spend, admins and the super admin
// get the whole workspace.
// --------------------------------------------------

export type HistoryRecord = {
  id: string;
  predictionId: string;
  user: string;
  userId?: string;
  project: string;
  model: string;
  prompt: string;
  outputUrl: string | null;
  inputImage: string | null;
  aspectRatio: string;
  resolution: string;
  costUsd: number | null;
  status: string;
  createdAt: string;
  predictTime?: number | null;
};

export async function fetchActiveProjects(): Promise<PublicProject[]> {
  const data = await fetchJson<{ projects?: PublicProject[] }>(
    "/api/projects"
  );

  return data.projects ?? [];
}

export async function fetchGenerations(): Promise<HistoryRecord[]> {
  const data = await fetchJson<{ generations?: HistoryRecord[] }>(
    "/api/generations"
  );

  return data.generations ?? [];
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
