import type { Metadata } from "next";
import AccountView from "./AccountView";

export const metadata: Metadata = { title: "Account" };

export default function Page() {
  return <AccountView />;
}
