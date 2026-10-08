"use client";

import { useStudio } from "@/app/(studio)/_components/StudioProvider";
import UsersAdmin from "@/app/components/UsersAdmin";
import { PageHeader } from "@/app/components/ui/primitives";

export default function UsersView() {
  const { currentUser } = useStudio();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Users"
        description={
          currentUser.role === "super_admin"
            ? "Add admins and users, set their passwords and roles."
            : "Add users and set their passwords."
        }
      />

      <UsersAdmin currentUser={currentUser} />
    </div>
  );
}
