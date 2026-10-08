"use client";

import { useStudio } from "@/app/(studio)/_components/StudioProvider";
import ManagementPage from "@/app/components/ManagementPage";

// Admin screens; refreshes the shared project list so
// the Generate dropdown picks up changes immediately.
export default function AdminView() {
  const { currentUser, refreshProjects } = useStudio();

  return (
    <ManagementPage
      currentUser={currentUser}
      onProjectsChanged={refreshProjects}
    />
  );
}
