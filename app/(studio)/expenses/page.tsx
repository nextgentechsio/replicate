import type { Metadata } from "next";
import ExpensesView from "./ExpensesView";

export const metadata: Metadata = { title: "Expenses" };

export default function Page() {
  return <ExpensesView />;
}
