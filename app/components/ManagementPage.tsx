"use client";

import { useState } from "react";
import ProjectsAdmin from "@/app/components/ProjectsAdmin";
import UsersAdmin from "@/app/components/UsersAdmin";
import {
  canDeleteProjects,
  canManageProjects,
  type PublicUser,
} from "@/lib/roles";

// --------------------------------------------------
// USER & PROJECT MANAGEMENT
//
// Super admin and admin: Users + Projects tabs
// (only the super admin can delete a project)
// --------------------------------------------------

type Tab = "users" | "projects";

export default function ManagementPage({
  currentUser,
  onProjectsChanged,
}: {
  currentUser: PublicUser;
  onProjectsChanged?: () => void;
}) {
  const showProjects = canManageProjects(currentUser);
  const [tab, setTab] = useState<Tab>("users");

  const activeTab: Tab = showProjects ? tab : "users";

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-fg-subtle">
          Admin
        </p>

        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-fg sm:text-[32px]">
          {showProjects
            ? "User & Project Management"
            : "User Management"}
        </h1>

        <p className="mt-1 text-sm text-fg-muted">
          {showProjects
            ? "Add people, set their passwords and roles, and create projects."
            : "Add people and set their passwords."}
        </p>
      </div>

      {showProjects && (
        <div className="flex gap-1 rounded-xl border border-line bg-surface p-1 sm:w-fit">
          {(
            [
              ["users", "Users"],
              ["projects", "Projects"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex-1 rounded-lg px-4 py-2 text-sm transition sm:flex-none ${
                activeTab === id
                  ? "bg-accent font-semibold text-on-accent"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {activeTab === "users" ? (
        <UsersAdmin currentUser={currentUser} />
      ) : (
        <ProjectsAdmin
          canDelete={canDeleteProjects(currentUser)}
          onProjectsChanged={onProjectsChanged}
        />
      )}
    </div>
  );
}
