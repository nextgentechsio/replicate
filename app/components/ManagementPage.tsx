"use client";

import { useState } from "react";
import ProjectsAdmin from "@/app/components/ProjectsAdmin";
import UsersAdmin from "@/app/components/UsersAdmin";
import {
  canManageProjects,
  type PublicUser,
} from "@/lib/roles";

// --------------------------------------------------
// USER & PROJECT MANAGEMENT
//
// Super admin: Users + Projects tabs
// Admin:       Users tab only
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
        <h1 className="text-2xl font-semibold">
          {showProjects
            ? "User & Project Management"
            : "User Management"}
        </h1>

        <p className="mt-1 text-sm text-zinc-500">
          {showProjects
            ? "Add people, set their passwords and roles, and create projects."
            : "Add people and set their passwords."}
        </p>
      </div>

      {showProjects && (
        <div className="flex gap-1 rounded-xl border border-zinc-800 bg-zinc-900/70 p-1 sm:w-fit">
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
                  ? "bg-white font-semibold text-black"
                  : "text-zinc-400 hover:text-white"
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
        <ProjectsAdmin onProjectsChanged={onProjectsChanged} />
      )}
    </div>
  );
}
