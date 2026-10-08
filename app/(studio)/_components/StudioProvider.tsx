"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { fetchActiveProjects } from "@/lib/client/data";
import { errorMessage } from "@/lib/client/http";
import type { PublicProject, PublicUser } from "@/lib/roles";

// --------------------------------------------------
// STUDIO CONTEXT
//
// The signed-in user (resolved on the server by the
// layout) and the active project list, shared by every
// page. Lives in the layout, so it survives navigation.
// --------------------------------------------------

type StudioContextValue = {
  currentUser: PublicUser;
  // When this session signed in (ms since epoch)
  sessionStartedAt: number;
  projects: PublicProject[];
  projectsError: string;
  refreshProjects: () => void;
};

const StudioContext = createContext<StudioContextValue | null>(null);

export function StudioProvider({
  currentUser,
  sessionStartedAt,
  children,
}: {
  currentUser: PublicUser;
  sessionStartedAt: number;
  children: React.ReactNode;
}) {
  const [projects, setProjects] = useState<PublicProject[]>([]);
  const [projectsError, setProjectsError] = useState("");

  const refreshProjects = useCallback(() => {
    fetchActiveProjects()
      .then((list) => {
        setProjects(list);
        setProjectsError("");
      })
      .catch((err) =>
        setProjectsError(errorMessage(err, "Unable to load projects."))
      );
  }, []);

  // State is only set in the promise callbacks
  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  return (
    <StudioContext.Provider
      value={{
        currentUser,
        sessionStartedAt,
        projects,
        projectsError,
        refreshProjects,
      }}
    >
      {children}
    </StudioContext.Provider>
  );
}

export function useStudio(): StudioContextValue {
  const value = useContext(StudioContext);

  if (!value) {
    throw new Error("useStudio must be used inside <StudioProvider>");
  }

  return value;
}

export async function signOut() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    // Full reload on purpose: drop every bit of client
    // state (Generate draft, cached data) on sign-out
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }
}
