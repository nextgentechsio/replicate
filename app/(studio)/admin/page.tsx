import { redirect } from "next/navigation";

// Old combined page: Users and Projects are separate now
export default function Page() {
  redirect("/admin/users");
}
