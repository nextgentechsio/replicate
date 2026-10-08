import type { Metadata } from "next";
import { Suspense } from "react";
import HistoryView from "./HistoryView";

export const metadata: Metadata = { title: "History" };

// HistoryView reads filters from the URL
// (useSearchParams), which needs a Suspense boundary
export default function Page() {
  return (
    <Suspense>
      <HistoryView />
    </Suspense>
  );
}
