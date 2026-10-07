"use client";

import { useCallback, useEffect, useState } from "react";
import type { PublicProject } from "@/lib/roles";

// --------------------------------------------------
// PROJECT MANAGEMENT (super admin only)
//
// Every action is re-checked by /api/projects.
// Archived projects disappear from the Generate page
// but keep their history.
// --------------------------------------------------

type FormState = {
  mode: "create" | "edit";
  id?: string;
  name: string;
  description: string;
};

const inputClass =
  "h-11 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm outline-none focus:border-zinc-500";

async function callApi(
  url: string,
  init?: RequestInit
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      (data as { error?: string }).error ||
        `Request failed (${response.status})`
    );
  }

  return data;
}

export default function ProjectsAdmin({
  onProjectsChanged,
}: {
  // Lets the parent refresh the Generate dropdown
  onProjectsChanged?: () => void;
}) {
  const [projects, setProjects] = useState<PublicProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState<FormState | null>(null);

  // `loading` starts true; reloads refresh in place
  const loadProjects = useCallback(async () => {
    try {
      const data = await callApi("/api/projects?all=1");
      setProjects((data.projects as PublicProject[]) ?? []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load projects"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load (state is only set in the callbacks)
  useEffect(() => {
    let cancelled = false;

    callApi("/api/projects?all=1")
      .then((data) => {
        if (!cancelled) {
          setProjects(
            (data.projects as PublicProject[]) ?? []
          );
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load projects"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function afterChange(message: string) {
    setNotice(message);
    await loadProjects();
    onProjectsChanged?.();
  }

  function openCreate() {
    setError("");
    setNotice("");
    setForm({ mode: "create", name: "", description: "" });
  }

  function openEdit(project: PublicProject) {
    setError("");
    setNotice("");
    setForm({
      mode: "edit",
      id: project.id,
      name: project.name,
      description: project.description,
    });
  }

  async function submitForm(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!form) return;

    setError("");
    setNotice("");
    setSaving(true);

    try {
      if (form.mode === "create") {
        await callApi("/api/projects", {
          method: "POST",
          body: JSON.stringify({
            name: form.name,
            description: form.description,
          }),
        });
      } else {
        await callApi(`/api/projects/${form.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: form.name,
            description: form.description,
          }),
        });
      }

      const message =
        form.mode === "create"
          ? `Created ${form.name}.`
          : `Updated ${form.name}.`;

      setForm(null);
      await afterChange(message);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Save failed"
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchived(project: PublicProject) {
    setError("");
    setNotice("");

    const archiving = project.status === "active";

    try {
      await callApi(`/api/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: archiving ? "archived" : "active",
        }),
      });

      await afterChange(
        `${project.name} ${
          archiving ? "archived" : "restored"
        }.`
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Update failed"
      );
    }
  }

  async function removeProject(project: PublicProject) {
    if (
      !window.confirm(
        `Delete ${project.name}? This cannot be undone. Archive it instead to keep it out of the Generate page.`
      )
    ) {
      return;
    }

    setError("");
    setNotice("");

    try {
      await callApi(`/api/projects/${project.id}`, {
        method: "DELETE",
      });

      await afterChange(`Deleted ${project.name}.`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Delete failed"
      );
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="text-sm text-zinc-500">
          Active projects appear in the Generate page.
        </p>

        <button
          type="button"
          onClick={openCreate}
          className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200"
        >
          Add project
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      {form && (
        <form
          onSubmit={submitForm}
          className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5"
        >
          <h2 className="font-semibold">
            {form.mode === "create"
              ? "New project"
              : `Edit ${form.name}`}
          </h2>

          <div className="space-y-2">
            <label className="text-sm text-zinc-300">
              Project name
            </label>

            <input
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              required
              maxLength={60}
              autoComplete="off"
              placeholder="e.g. Landmark"
              className={inputClass}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-zinc-300">
              Description (optional)
            </label>

            <textarea
              value={form.description}
              onChange={(event) =>
                setForm({
                  ...form,
                  description: event.target.value,
                })
              }
              rows={3}
              maxLength={500}
              className="w-full resize-y rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-500"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-600"
            >
              {saving ? "Saving..." : "Save"}
            </button>

            <button
              type="button"
              onClick={() => setForm(null)}
              className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/70">
        {loading ? (
          <div className="p-10 text-center text-sm text-zinc-600">
            Loading projects...
          </div>
        ) : !projects.length ? (
          <div className="p-10 text-center text-sm text-zinc-600">
            No projects yet. Add one to start generating.
          </div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {projects.map((project) => (
              <div
                key={project.id}
                className="grid items-center gap-3 px-5 py-4 md:grid-cols-[1fr_100px_auto]"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-200">
                    {project.name}
                  </p>

                  <p className="mt-1 line-clamp-2 text-xs text-zinc-600">
                    {project.description || "No description"}
                  </p>
                </div>

                <span
                  className={`text-xs ${
                    project.status === "active"
                      ? "text-emerald-400"
                      : "text-zinc-500"
                  }`}
                >
                  {project.status === "active"
                    ? "Active"
                    : "Archived"}
                </span>

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => openEdit(project)}
                    className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleArchived(project)}
                    className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
                  >
                    {project.status === "active"
                      ? "Archive"
                      : "Restore"}
                  </button>

                  <button
                    type="button"
                    onClick={() => removeProject(project)}
                    className="rounded-lg border border-red-900 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/40"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
