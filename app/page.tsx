"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ManagementPage from "@/app/components/ManagementPage";
import ProjectAvatar from "@/app/components/ProjectAvatar";
import ThemeToggle from "@/app/components/ThemeToggle";
import { Icon, type IconName } from "@/app/components/ui/Icon";
import { NaarLogo } from "@/app/components/ui/NaarLogo";
import {
  Alert,
  Badge,
  Button,
  Card,
  cx,
  EmptyState,
  Field,
  formatCost,
  inputClass,
  PageHeader,
  Spinner,
  StepHeader,
  textareaClass,
} from "@/app/components/ui/primitives";
import {
  findCatalogModel,
  KIND_LABELS,
  MODEL_CATALOG,
  type ModelKind,
} from "@/lib/model-catalog";
import { calculateReplicateCost } from "@/lib/replicate-cost";
import type {
  ExpenseReport,
  SpendGroup,
  SpendTotal,
} from "@/lib/expenses";
import {
  canManageProjects,
  canManageUsers,
  ROLE_LABELS,
  type PublicProject,
  type PublicUser,
} from "@/lib/roles";

type Model = {
  id: string;
  owner: string;
  name: string;
  description?: string | null;
  coverImageUrl?: string | null;
  runCount?: number;
};

type SchemaProperty = {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  format?: string;
  minimum?: number;
  maximum?: number;
  "x-order"?: number;
};

type Schema = Record<string, SchemaProperty>;

type HistoryRecord = {
  id: string;
  predictionId: string;
  user: string;
  // Missing on records created before accounts existed
  userId?: string;
  project: string;
  model: string;
  prompt: string;
  outputUrl: string | null;
  inputImage: string | null;
  aspectRatio: string;
  resolution: string;
  costUsd: number | null;
  status: string;
  createdAt: string;
  predictTime?: number | null;
};

type GenerationResult = {
  success: boolean;
  tracking: {
    user: string;
    project: string;
    provider: string;
    model: string;
    version: string;
    predictionId: string;
    status: string;
    createdAt?: string;
  };
  prediction: {
    id: string;
    status: string;
    output?: unknown;
    error?: string | null;
    costUsd?: number | null;
    metrics?: {
      predict_time?: number;
      total_time?: number;
      cost?: number;
    };
    urls?: {
      web?: string;
      get?: string;
    };
  };
  costUsd?: number | null;
};

type Page =
  | "dashboard"
  | "generate"
  | "history"
  | "expenses"
  | "users"
  | "settings";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_CONSECUTIVE_POLL_ERRORS = 10;

const ASPECT_RATIOS = [
  "match_input_image",
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
  "1:4",
  "4:1",
  "1:8",
  "8:1",
];

// Uncontrolled so typing never loses focus on re-render;
// remount it (via `key`) when its value must reset.
function StableTextArea({
  value,
  onChange,
  rows = 6,
  ...props
}: Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange" | "defaultValue"
> & {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <textarea
      {...props}
      rows={rows}
      defaultValue={value}
      onChange={(event) => onChange(event.target.value)}
      autoComplete="off"
      spellCheck={false}
    />
  );
}

// --------------------------------------------------
// FIELD CLASSIFICATION (Generate page)
// --------------------------------------------------

type FileKind = "image" | "video" | "audio";

function isScalarField(field: SchemaProperty) {
  return (
    Boolean(field.enum?.length) ||
    field.type === "boolean" ||
    field.type === "number" ||
    field.type === "integer"
  );
}

// Upload fields, judged by name/format like before
function fileKind(
  key: string,
  field: SchemaProperty
): FileKind | null {
  if (isScalarField(field)) return null;

  const lower = key.toLowerCase();

  if (
    lower.includes("video") &&
    !lower.includes("reference_type")
  ) {
    return "video";
  }

  if (lower.includes("audio")) return "audio";

  if (lower.includes("image") || field.format === "uri") {
    return "image";
  }

  return null;
}

// Tuning knobs most people never touch. Cost-relevant
// inputs (duration, resolution, quality, audio, fps)
// deliberately stay visible.
const ADVANCED_FIELD =
  /seed|guidance|steps|cfg|strength|safety|output_format|output_quality|negative|disable_|enable_|go_fast|lora|sampler|scheduler|megapixels/i;

function fieldGroup(
  key: string,
  field: SchemaProperty
): "media" | "main" | "advanced" {
  if (fileKind(key, field)) return "media";
  if (ADVANCED_FIELD.test(key)) return "advanced";
  return "main";
}

// Shape the form values into what Replicate expects
// (single URL vs array per field). Shared by Generate
// and the cost preview so the estimate prices exactly
// what will be sent.
function buildGenerationInputs(
  inputs: Record<string, unknown>
): Record<string, unknown> {
  return {
  ...inputs,

  // IMAGE INPUT
  ...(inputs.image_input
    ? {
        image_input: Array.isArray(inputs.image_input)
          ? inputs.image_input
          : [inputs.image_input],
      }
    : {}),

  // START IMAGE — optional, single URL
  ...(Array.isArray(inputs.start_image)
    ? inputs.start_image.length > 0
      ? { start_image: inputs.start_image[0] }
      : {}
    : inputs.start_image
      ? { start_image: inputs.start_image }
      : {}),

  // END IMAGE — optional, single URL
  ...(Array.isArray(inputs.end_image)
    ? inputs.end_image.length > 0
      ? { end_image: inputs.end_image[0] }
      : {}
    : inputs.end_image
      ? { end_image: inputs.end_image }
      : {}),

  // REFERENCE IMAGES — optional array
  ...(inputs.reference_images
    ? {
        reference_images: Array.isArray(inputs.reference_images)
          ? inputs.reference_images
          : [inputs.reference_images],
      }
    : {}),

  // REFERENCE VIDEO — optional, single URL
  ...(Array.isArray(inputs.reference_video)
    ? inputs.reference_video.length > 0
      ? { reference_video: inputs.reference_video[0] }
      : {}
    : inputs.reference_video
      ? { reference_video: inputs.reference_video }
      : {}),

  // RESOLUTION
  ...(inputs.resolution
    ? {
        resolution: inputs.resolution,
      }
    : {}),
};
}

// Kept as an alias so the Expenses page uses the same
// cost formatting as everywhere else
const formatUsd = formatCost;

// Spend grouped by project or user (Expenses page)
function GroupTable({
  title,
  groups,
}: {
  title: string;
  groups: SpendGroup[];
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="border-b border-line px-5 py-4 font-semibold">
        {title}
      </div>

      {!groups.length ? (
        <div className="p-8 text-center text-sm text-fg-subtle">
          No spend yet.
        </div>
      ) : (
        <div className="divide-y divide-line">
          {groups.map((group) => (
            <div
              key={group.id}
              className="flex items-center justify-between gap-3 px-5 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-fg">
                  {group.name}
                </p>

                <p className="mt-0.5 text-xs text-fg-subtle">
                  {group.count} billed
                  {group.unpriced
                    ? ` · ${group.unpriced} unpriced`
                    : ""}
                </p>
              </div>

              <span className="text-sm text-fg">
                {formatUsd(group.amountUsd)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [page, setPage] = useState<Page>("generate");

  const [currentUser, setCurrentUser] =
    useState<PublicUser | null>(null);

  // Display name of the signed-in account; the server
  // attributes generations from the session, not this.
  const user = currentUser?.name ?? "";
  const isManager = currentUser
    ? canManageUsers(currentUser)
    : false;

  // Active projects from MongoDB (managed by admins and
  // the super admin)
  const [projectList, setProjectList] = useState<
    PublicProject[]
  >([]);
  const projects = projectList.map((item) => item.name);

  const [selectedProject, setProject] = useState("");

  // Starts blank so the user must pick a project. Also
  // resets to blank if the chosen project is archived or
  // renamed meanwhile.
  const project = projects.includes(selectedProject)
    ? selectedProject
    : "";

  const [search, setSearch] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState("");

  const [schema, setSchema] =
    useState<Schema>({});

  const [inputs, setInputs] =
    useState<Record<string, unknown>>({});
const [filePreviews, setFilePreviews] =
  useState<Record<string, string[]>>({});

  // Uploads in flight per input field
  const [uploading, setUploading] =
    useState<Record<string, number>>({});

  // Generate page: model catalog filter + "other model" panel
  const [catalogFilter, setCatalogFilter] =
    useState<ModelKind | "all">("all");
  const [showOtherModels, setShowOtherModels] =
    useState(false);

  // Mobile navigation drawer
  const [navOpen, setNavOpen] = useState(false);
  const [loadingModels, setLoadingModels] =
    useState(false);

  const [schemaLoading, setSchemaLoading] =
    useState(false);

  const [generating, setGenerating] =
    useState(false);

  const [result, setResult] =
    useState<GenerationResult | null>(null);

  const [error, setError] = useState("");

  const [history, setHistory] =
    useState<HistoryRecord[]>([]);

  const [expenseReport, setExpenseReport] =
    useState<ExpenseReport | null>(null);

  const activePredictionRef =
    useRef<string | null>(null);

  // --------------------------------------------------
  // CURRENT USER
  // --------------------------------------------------

  useEffect(() => {
    async function loadCurrentUser() {
      try {
        const response = await fetch("/api/auth/me", {
          cache: "no-store",
        });

        if (response.status === 401) {
          window.location.assign("/login");
          return;
        }

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || "Unable to load account"
          );
        }

        setCurrentUser(data.user);
      } catch (err) {
        console.error(err);
        setError("Unable to load your account.");
      }
    }

    loadCurrentUser();
  }, []);

  // --------------------------------------------------
  // PROJECTS
  // --------------------------------------------------

  function fetchActiveProjects(): Promise<PublicProject[]> {
    return fetch("/api/projects", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || "Unable to load projects"
          );
        }

        return (data.projects as PublicProject[]) ?? [];
      });
  }

  // Called after an admin edits projects
  function refreshProjects() {
    fetchActiveProjects()
      .then(setProjectList)
      .catch((err) => console.error(err));
  }

  useEffect(() => {
    fetchActiveProjects()
      .then(setProjectList)
      .catch((err) => {
        console.error(err);
        setError("Unable to load projects.");
      });
  }, []);

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
      });
    } finally {
      window.location.assign("/login");
    }
  }

  // --------------------------------------------------
  // HISTORY (MongoDB via /api/generations)
  //
  // The server writes every record and already scopes
  // the list: users get their own generations, admins
  // and the super admin get everyone's.
  // --------------------------------------------------

  function fetchHistory(): Promise<HistoryRecord[]> {
    return fetch("/api/generations", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || "Unable to load history"
          );
        }

        return (data.generations as HistoryRecord[]) ?? [];
      });
  }

  // --------------------------------------------------
  // EXPENSES (MongoDB ledger via /api/expenses)
  //
  // Totals are aggregated on the server; we only send
  // the viewer's local midnights so "today", "this week"
  // and "this month" match their timezone.
  // --------------------------------------------------

  function fetchExpenses(): Promise<ExpenseReport> {
    const now = new Date();

    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );

    const weekStart = new Date(todayStart);
    weekStart.setDate(
      todayStart.getDate() - todayStart.getDay()
    );

    const monthStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      1
    );

    const params = new URLSearchParams({
      todayStart: todayStart.toISOString(),
      weekStart: weekStart.toISOString(),
      monthStart: monthStart.toISOString(),
    });

    return fetch(`/api/expenses?${params}`, {
      cache: "no-store",
    }).then(async (response) => {
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Unable to load expenses"
        );
      }

      return data as ExpenseReport;
    });
  }

  // History and expenses change together
  function refreshHistory() {
    fetchHistory()
      .then(setHistory)
      .catch((err) => console.error(err));

    fetchExpenses()
      .then(setExpenseReport)
      .catch((err) => console.error(err));
  }

  useEffect(() => {
    fetchHistory()
      .then(setHistory)
      .catch((err) => {
        console.error(err);
        setError("Unable to load history.");
      });

    fetchExpenses()
      .then(setExpenseReport)
      .catch((err) => {
        console.error(err);
        setError("Unable to load expenses.");
      });
  }, []);

  const visibleHistory = history;

  // --------------------------------------------------
  // HELPERS
  // --------------------------------------------------

  function getOutputUrls(
  output: unknown
): string[] {
  if (typeof output === "string") {
    return [output];
  }

  if (Array.isArray(output)) {
    return output.filter(
      (item): item is string =>
        typeof item === "string"
    );
  }

  return [];
}

function getOutputType(
  url: string
): "image" | "video" | "audio" | "file" {
  const pathname = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();

  if (/\.(mp4|webm|mov|m4v|avi)$/i.test(pathname)) {
    return "video";
  }

  if (/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(pathname)) {
    return "audio";
  }

  if (
    /\.(jpg|jpeg|png|webp|gif|avif|bmp|tiff)$/i.test(
      pathname
    )
  ) {
    return "image";
  }

  return "file";
}

function getInputImage(): string | null {    const value = inputs.image_input;

    if (Array.isArray(value)) {
      return String(value[0] ?? "") || null;
    }

    if (typeof value === "string") {
      return value || null;
    }

    return null;
  }

  function getAvailableCost(value: unknown): number | null {
    if (typeof value !== "number") return null;
    if (!Number.isFinite(value)) return null;
    if (value < 0) return null;
    return value;
  }

  function getPredictionCost(
    prediction: any,
    fallbackCost?: unknown
  ): number | null {
    const candidates = [
      prediction?.costUsd,
      prediction?.cost,
      prediction?.metrics?.cost,
      fallbackCost,
    ];

    for (const candidate of candidates) {
      const cost = getAvailableCost(candidate);
      if (cost !== null && cost > 0) {
        return cost;
      }
    }

    return null;
  }

  
  function updateHistoryRecord(
    predictionId: string,
    patch: Partial<HistoryRecord>
  ) {
    setHistory((previous) =>
      previous.map((item) =>
        item.predictionId === predictionId
          ? {
              ...item,
              ...patch,
            }
          : item
      )
    );
  }

  function addInitialHistoryRecord(
    predictionId: string,
    costUsd: number | null,
    outputUrl: string | null
  ) {
    if (!predictionId) return;

    const record: HistoryRecord = {
      id: crypto.randomUUID(),
      predictionId,
      user,
      userId: currentUser?.id,
      project,
      model,
      prompt: String(inputs.prompt ?? ""),
      outputUrl,
      inputImage: getInputImage(),
      aspectRatio: String(
        inputs.aspect_ratio ?? ""
      ),
      resolution: String(
        inputs.resolution ?? ""
      ),
      costUsd,
      status: "starting",
      createdAt:
        new Date().toISOString(),
    };

    setHistory((previous) => {
      const alreadyExists =
        previous.some(
          (item) =>
            item.predictionId === predictionId
        );

      if (alreadyExists) {
        return previous;
      }

      return [
        record,
        ...previous,
      ];
    });
  }

  async function downloadImage(
  url: string,
  filename = "ai-output"
) {
  try {
    if (!url) {
      throw new Error("Download URL is missing");
    }

    // Saved outputs (/history/...) are served by this app;
    // remote Replicate URLs go through the download proxy.
    const response = await fetch(
      url.startsWith("/history/")
        ? url
        : `/api/download?url=${encodeURIComponent(url)}`
    );

    if (!response.ok) {
      let message = "Download failed";

      try {
        const data = await response.json();
        message = data?.error || message;
      } catch {}

      throw new Error(message);
    }

    const blob = await response.blob();

    if (!blob || blob.size === 0) {
      throw new Error("Downloaded file is empty");
    }

    const contentType =
      response.headers.get("content-type") ||
      blob.type ||
      "application/octet-stream";

    let extension = ".bin";

    if (contentType.includes("video/mp4")) {
      extension = ".mp4";
    } else if (contentType.includes("video/webm")) {
      extension = ".webm";
    } else if (contentType.includes("image/png")) {
      extension = ".png";
    } else if (
      contentType.includes("image/jpeg") ||
      contentType.includes("image/jpg")
    ) {
      extension = ".jpg";
    } else if (contentType.includes("image/webp")) {
      extension = ".webp";
    }

    const blobUrl =
      window.URL.createObjectURL(blob);

    const link =
      document.createElement("a");

    link.href = blobUrl;
    link.download =
      `${filename}${extension}`;

    document.body.appendChild(link);

    link.click();

    link.remove();

    setTimeout(() => {
      window.URL.revokeObjectURL(blobUrl);
    }, 1000);
  } catch (error) {
    console.error(
      "DOWNLOAD ERROR:",
      error
    );

    setError(
      error instanceof Error
        ? error.message
        : "Download failed"
    );
  }
}
  // --------------------------------------------------
  // MODEL SEARCH
  // --------------------------------------------------

  useEffect(() => {
    const query =
      search.trim();

    if (!query) {
      return;
    }

    if (query === model) {
      return;
    }

    const timer =
      setTimeout(async () => {
        try {
          setLoadingModels(true);
          setError("");

          const response =
            await fetch(
              `/api/models/search?q=${encodeURIComponent(
                query
              )}`,
              {
                cache: "no-store",
              }
            );

          const data =
            await response.json();

          if (!response.ok) {
            throw new Error(
              data.error ||
                "Unable to search models"
            );
          }

          setModels(
            Array.isArray(data.models)
              ? data.models
              : []
          );

        } catch (err) {
          console.error(err);

          setModels([]);

          setError(
            "Unable to search models."
          );
        } finally {
          setLoadingModels(false);
        }
      }, 400);

    return () =>
      clearTimeout(timer);
  }, [search, model]);

  // --------------------------------------------------
  // LOAD MODEL SCHEMA
  // --------------------------------------------------

  useEffect(() => {
    if (!model) {
      setSchema({});
      setInputs({});
      return;
    }

    async function loadSchema() {
      try {
        setSchemaLoading(true);
        setError("");

        const response =
          await fetch(
            `/api/models/schema?model=${encodeURIComponent(
              model
            )}`,
            {
              cache: "no-store",
            }
          );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              "Unable to load model settings"
          );
        }

        const modelSchema =
          (data.inputSchema ||
            {}) as Schema;

        setSchema(modelSchema);

        const defaults: Record<
          string,
          unknown
        > = {};

        Object.entries(
          modelSchema
        ).forEach(
          ([key, field]) => {
            if (
              field.default !==
              undefined
            ) {
              defaults[key] =
                field.default;
            } else if (
              field.type ===
              "boolean"
            ) {
              defaults[key] =
                false;
            } else if (
              field.enum?.length
            ) {
              defaults[key] =
                field.enum[0];
            } else {
              defaults[key] = "";
            }
          }
        );

        // Common image-model defaults
        if (
          model ===
          "google/nano-banana-2"
        ) {
          defaults.aspect_ratio =
            defaults.aspect_ratio ||
            "match_input_image";

          defaults.resolution =
            defaults.resolution ||
            "2K";
        }

        setInputs(defaults);
        setResult(null);
      } catch (err) {
        console.error(err);

        setSchema({});
        setInputs({});

        setError(
          "Unable to load model settings."
        );
      } finally {
        setSchemaLoading(false);
      }
    }

    loadSchema();
  }, [model]);

  // --------------------------------------------------
  // ORDERED FIELDS
  // --------------------------------------------------

  const orderedFields =
    useMemo(() => {
      return Object.entries(schema)
        .filter(([key]) => {
          const lower =
            key.toLowerCase();

          return (
            lower !== "prompt" &&
            lower !==
              "aspect_ratio" &&
            lower !==
              "resolution" &&
            !lower.includes(
              "safety_filter"
            )
          );
        })
        .sort(
          ([, first], [, second]) =>
            (first["x-order"] ??
              999) -
            (second["x-order"] ??
              999)
        );
    }, [schema]);

  // --------------------------------------------------
  // INPUT UPDATE
  // --------------------------------------------------

  function updateInput(
    key: string,
    value: unknown
  ) {
    setInputs(
      (previous) => ({
        ...previous,
        [key]: value,
      })
    );
  }

  // --------------------------------------------------
  // SELECT MODEL
  // --------------------------------------------------

  function selectModel(
    selectedModel: Model
  ) {
    setModel(
      selectedModel.id
    );

    setSearch(
      selectedModel.id
    );

    setModels([]);

    setResult(null);
    setError("");
  }

  // --------------------------------------------------
  // CHOOSE MODEL (approved catalog / clear)
  // --------------------------------------------------

  function chooseModel(id: string) {
    setModel(id);
    // Clear the "other model" search so it doesn't
    // re-run for the previous query
    setSearch("");
    setModels([]);
    setResult(null);
    setError("");
  }

  // --------------------------------------------------
  // FILE UPLOAD
  // --------------------------------------------------

 async function handleFileUpload(
  key: string,
  file?: File
) {
  if (!file) return;

  // Per-field upload counter drives the "Uploading…" state
  setUploading((previous) => ({
    ...previous,
    [key]: (previous[key] ?? 0) + 1,
  }));

  try {
    setError("");

    // VIDEO / AUDIO: single file per field
    if (
      file.type.startsWith("video/") ||
      file.type.startsWith("audio/")
    ) {
      const formData = new FormData();

      formData.append(
        "file",
        file,
        file.name
      );

      const response = await fetch(
        "/api/upload",
        {
          method: "POST",
          body: formData,
        }
      );

      const responseText =
        await response.text();

      let data: any = {};

      try {
        data = responseText
          ? JSON.parse(responseText)
          : {};
      } catch {
        throw new Error(
          responseText ||
            `Upload failed (${response.status})`
        );
      }

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Video upload failed."
        );
      }

      if (!data.url) {
        throw new Error(
          "Replicate did not return a file URL."
        );
      }

      updateInput(
        key,
        data.url
      );

      return;
    }

    // IMAGE
    if (
      file.type.startsWith("image/") &&
      file.size > 26 * 1024 * 1024
    ) {
      setError(
        "For this local MVP, please use an image smaller than 26 MB."
      );
      return;
    }

    const formData = new FormData();

formData.append(
  "file",
  file,
  file.name
);

const response = await fetch(
  "/api/upload",
  {
    method: "POST",
    body: formData,
  }
);

const responseText =
  await response.text();

let data: any = {};

try {
  data = responseText
    ? JSON.parse(responseText)
    : {};
} catch {
  throw new Error(
    responseText ||
      `Upload failed (${response.status})`
  );
}

if (!response.ok) {
  throw new Error(
    data.error ||
      "File upload failed."
  );
}

if (!data.url) {
  throw new Error(
    "Upload did not return a file URL."
  );
}
const previewUrl = URL.createObjectURL(file);

setFilePreviews((previous) => ({
  ...previous,
  [key]: [
    ...(previous[key] ?? []),
    previewUrl,
  ],
}));
setInputs((previous) => {
  const currentValue =
    previous[key];

  const currentImages =
    Array.isArray(currentValue)
      ? currentValue
      : currentValue
        ? [currentValue]
        : [];

  return {
    ...previous,
    [key]: [
      ...currentImages,
      data.url,
    ],
  };
});
  } catch (err) {
    console.error(err);

    setError(
      err instanceof Error
        ? err.message
        : "Unable to upload the file."
    );
  } finally {
    setUploading((previous) => ({
      ...previous,
      [key]: Math.max(0, (previous[key] ?? 1) - 1),
    }));
  }
}

  // --------------------------------------------------
  // GENERATE
  // --------------------------------------------------

  async function handleGenerate() {
    setError("");
    setResult(null);

    if (!user) {
      setError(
        "Please select a user."
      );
      return;
    }

    if (!project) {
      setError(
        "Please select a project."
      );
      return;
    }

    if (!model) {
      setError(
        "Please select a model."
      );
      return;
    }

    try {
      setGenerating(true);

      const generationInputs =
        buildGenerationInputs(inputs);
      const response =
        await fetch(
          "/api/generate",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              user,
              project,
              model,
              inputs:
                generationInputs,
            }),
          }
        );
 
      const data =
        await response.json();

      console.log(
        "GENERATION DATA:",
        data
      );

      console.log(
        "COST USD:",
        data.costUsd
      );

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Generation failed"
        );
      }

      const initialCost =
        getPredictionCost(
          data.prediction,
          data.costUsd
        );

      setResult({
        ...data,
        costUsd: initialCost,
      });

      const predictionId =
        data.tracking
          ?.predictionId ||
        data.prediction?.id ||
        "";
      if (predictionId) {
        activePredictionRef.current =
          predictionId;

        addInitialHistoryRecord(
          predictionId,
          getPredictionCost(
            data.prediction,
            data.costUsd
          ),
          data.prediction?.urls
            ?.get ??
            data.urls?.get ??
            null
        );

        pollPrediction(
          predictionId
        );
      }
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "Generation failed."
      );
    } finally {
      setGenerating(false);
    }
  }

  // --------------------------------------------------
  // POLLING
  // --------------------------------------------------

  async function pollPrediction(
    predictionId: string
  ) {
    // Stop eventually so a stuck or missing prediction
    // doesn't hit the API every 2s forever.
    const startedAt = Date.now();
    let consecutiveErrors = 0;

    function scheduleNext() {
      if (
        Date.now() - startedAt >
        POLL_TIMEOUT_MS
      ) {
        stopPolling(
          "Stopped checking: generation took longer than 15 minutes. Check Replicate for the final result."
        );
        return;
      }

      setTimeout(poll, POLL_INTERVAL_MS);
    }

    function handlePollError() {
      consecutiveErrors++;

      if (
        consecutiveErrors >=
        MAX_CONSECUTIVE_POLL_ERRORS
      ) {
        stopPolling(
          "Stopped checking: the prediction status could not be fetched."
        );
        return;
      }

      scheduleNext();
    }

    function stopPolling(message: string) {
      setError(message);

      updateHistoryRecord(predictionId, {
        status: "unknown",
      });
    }

    const poll = async () => {
      try {
        const response =
          await fetch(
            `/api/predictions/${encodeURIComponent(predictionId)}`,
            {
              cache: "no-store",
            }
          );

        if (!response.ok) {
          handlePollError();
          return;
        }

        const data =
          await response.json();

        const prediction =
          data.prediction;

        if (!prediction) {
          handlePollError();
          return;
        }

        consecutiveErrors = 0;
const outputUrls =
  getOutputUrls(
    prediction?.output
  );
          setResult((previous) => {
  if (!previous) {
    return previous;
  }

  const polledCost = getPredictionCost(
    prediction,
    data.costUsd
  );

  return {
    ...previous,
    prediction,
    costUsd:
      polledCost ??
      previous.costUsd ??
      null,
    tracking: {
      ...previous.tracking,
      status: prediction.status,
    },
  };
});
        const status =
          prediction?.status;

        if (
          status ===
            "succeeded" ||
          status === "failed" ||
          status === "canceled"
        ) {
          const costUsd =
            getPredictionCost(
              prediction,
              data.costUsd
            );

          updateHistoryRecord(
            predictionId,
            {
              status:
                String(
                  status
                ),
              outputUrl:
                outputUrls[0] ??
                null,
              costUsd,
              createdAt:
                prediction?.created_at ??
                undefined,
              predictTime:
                prediction?.metrics
                  ?.predict_time,
            }
          );

          // Pick up the server's record (saved output URL,
          // final cost) from MongoDB
          refreshHistory();

          return;
        }

        scheduleNext();
      } catch (err) {
        console.error(
          "Prediction polling error:",
          err
        );

        handlePollError();
      }
    };

    setTimeout(
      poll,
      1500
    );
  }

  // --------------------------------------------------
  // FIELD RENDER
  //
  // One control per schema field, built on <Field> so
  // every input has a linked label and help text.
  // --------------------------------------------------

  function fieldLabel(key: string, field: SchemaProperty) {
    return (
      field.title ||
      key
        .replace(/_/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
    );
  }

  function renderField(
    key: string,
    field: SchemaProperty
  ) {
    const value = inputs[key];
    const label = fieldLabel(key, field);
    const kind = fileKind(key, field);
    const lowerKey = key.toLowerCase();

    const isLong =
      lowerKey.includes("description") ||
      lowerKey.includes("negative");

    // ENUM
    if (field.enum?.length) {
      return (
        <Field key={key} label={label} hint={field.description}>
          {(control) => (
            <select
              {...control}
              value={String(value ?? "")}
              onChange={(event) =>
                updateInput(key, event.target.value)
              }
              className={inputClass}
            >
              {field.enum!.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
        </Field>
      );
    }

    // BOOLEAN
    if (field.type === "boolean") {
      return (
        <label
          key={key}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-sunken p-3.5 transition-colors hover:border-line-strong"
        >
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) =>
              updateInput(key, event.target.checked)
            }
            className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
          />

          <span>
            <span className="block text-sm font-medium text-fg">
              {label}
            </span>

            {field.description && (
              <span className="mt-0.5 block text-xs leading-5 text-fg-subtle">
                {field.description}
              </span>
            )}
          </span>
        </label>
      );
    }

    // NUMBER
    if (
      field.type === "number" ||
      field.type === "integer"
    ) {
      const range =
        field.minimum !== undefined &&
        field.maximum !== undefined
          ? `Between ${field.minimum} and ${field.maximum}.`
          : "";

      return (
        <Field
          key={key}
          label={label}
          hint={
            [field.description, range]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
          {(control) => (
            <input
              {...control}
              type="number"
              inputMode="decimal"
              value={value === "" ? "" : String(value ?? "")}
              min={field.minimum}
              max={field.maximum}
              step={field.type === "integer" ? 1 : "any"}
              onChange={(event) =>
                updateInput(
                  key,
                  event.target.value === ""
                    ? ""
                    : Number(event.target.value)
                )
              }
              className={inputClass}
            />
          )}
        </Field>
      );
    }

    // FILE (image / video / audio)
    if (kind) {
      const single = kind !== "image";
      const busy = (uploading[key] ?? 0) > 0;

      const images =
        kind === "image"
          ? Array.isArray(value)
            ? value
            : typeof value === "string" && value
              ? [value]
              : []
          : [];

      const singleUrl =
        single && typeof value === "string" && value
          ? value
          : null;

      const acceptHint = {
        image: "PNG, JPG or WEBP · up to 26 MB · you can add several",
        video: "MP4, MOV or WEBM · one file",
        audio: "MP3, WAV or M4A · one file",
      }[kind];

      return (
        <Field key={key} label={label} hint={field.description}>
          {(control) => (
            <div className="space-y-3">
              <label
                htmlFor={control.id}
                className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong bg-sunken px-4 py-5 text-center transition-colors hover:border-accent hover:bg-accent-soft/40"
              >
                {busy ? (
                  <Spinner className="text-accent" />
                ) : (
                  <Icon
                    name="upload"
                    size={20}
                    className="text-fg-muted"
                  />
                )}

                <span className="text-sm font-medium text-fg">
                  {busy
                    ? "Uploading…"
                    : singleUrl
                      ? `Replace ${kind}`
                      : `Upload ${kind}`}
                </span>

                <span className="text-xs text-fg-subtle">
                  {acceptHint}
                </span>

                <input
                  {...control}
                  type="file"
                  accept={`${kind}/*`}
                  multiple={!single}
                  className="sr-only"
                  onChange={(event) => {
                    const files = event.target.files;

                    if (!files) return;

                    Array.from(files).forEach((file) => {
                      handleFileUpload(key, file);
                    });

                    event.target.value = "";
                  }}
                />
              </label>

              {/* VIDEO / AUDIO PREVIEW */}
              {singleUrl && (
                <div className="relative overflow-hidden rounded-lg border border-line bg-black">
                  {kind === "video" ? (
                    <video
                      src={singleUrl}
                      controls
                      playsInline
                      className="max-h-64 w-full object-contain"
                    />
                  ) : (
                    <audio
                      src={singleUrl}
                      controls
                      className="w-full"
                    />
                  )}

                  <Button
                    size="sm"
                    variant="secondary"
                    className="absolute right-2 top-2"
                    onClick={() => updateInput(key, "")}
                  >
                    Remove
                  </Button>
                </div>
              )}

              {/* IMAGE PREVIEWS */}
              {images.length > 0 && (
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {images.map((image, index) => (
                    <li
                      key={`${String(image)}-${index}`}
                      className="group relative aspect-square overflow-hidden rounded-lg border border-line bg-black"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={
                          filePreviews[key]?.[index] ??
                          String(image)
                        }
                        alt={`${label} ${index + 1}`}
                        className="h-full w-full object-cover"
                      />

                      <button
                        type="button"
                        aria-label={`Remove ${label} ${index + 1}`}
                        onClick={() => {
                          updateInput(
                            key,
                            images.filter((_, i) => i !== index)
                          );

                          // Keep previews aligned with inputs
                          setFilePreviews((previous) => ({
                            ...previous,
                            [key]: (previous[key] ?? []).filter(
                              (_, i) => i !== index
                            ),
                          }));
                        }}
                        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-black/70 text-white opacity-90 transition-opacity hover:opacity-100"
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Field>
      );
    }

    // LONG TEXT
    if (isLong) {
      return (
        <Field key={key} label={label} hint={field.description}>
          {(control) => (
            <StableTextArea
              {...control}
              rows={4}
              value={String(value ?? "")}
              onChange={(next) => updateInput(key, next)}
              placeholder={`Enter ${label.toLowerCase()}…`}
              className={textareaClass}
            />
          )}
        </Field>
      );
    }

    // NORMAL TEXT
    return (
      <Field key={key} label={label} hint={field.description}>
        {(control) => (
          <input
            {...control}
            value={String(value ?? "")}
            onChange={(event) =>
              updateInput(key, event.target.value)
            }
            className={inputClass}
          />
        )}
      </Field>
    );
  }

  // --------------------------------------------------
  // DASHBOARD
  // --------------------------------------------------
  function Dashboard() {
    const total =
      visibleHistory.length;

    const successful =
      visibleHistory.filter(
        (item) =>
          item.status ===
          "succeeded"
      ).length;

    // Spend comes from the MongoDB expense ledger
    const totalSpend =
      expenseReport?.totals.allTime.amountUsd ?? null;

    const todaySpend =
      expenseReport?.totals.today.amountUsd ?? null;

    const projectSpend =
      projectList.map((item) => {
        const group = expenseReport?.byProject.find(
          (entry) => entry.id === item.id
        );

        return {
          name: item.name,
          count: group?.count ?? 0,
          cost: group?.amountUsd ?? 0,
        };
      });

    return (
      <div className="space-y-6">
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-fg-subtle">
            Spend
          </p>

          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-fg sm:text-[32px]">
            Dashboard
          </h1>

          <p className="mt-1 text-sm text-fg-muted">
            AI generation
            workspace
            overview
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            [
              "Total Generations",
              String(total),
            ],
            [
              "Total Spend",
              totalSpend === null
                ? "—"
                : `$${totalSpend.toFixed(
                    4
                  )}`,
            ],
            [
              "Today",
              todaySpend === null
                ? "—"
                : `$${todaySpend.toFixed(
                    4
                  )}`,
            ],
            [
              "Success Rate",
              total
                ? `${Math.round(
                    (successful /
                      total) *
                      100
                  )}%`
                : "—",
            ],
          ].map(
            ([
              title,
              value,
            ]) => (
              <div
                key={title}
                className="rounded-2xl border border-line bg-surface p-5"
              >
                <p className="text-xs uppercase tracking-wider text-fg-subtle">
                  {title}
                </p>

                <p className="mt-4 text-2xl font-semibold">
                  {value}
                </p>
              </div>
            )
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="font-semibold">
              Recent
              generations
            </h2>

            <div className="mt-5 space-y-3">
              {visibleHistory
                .slice(
                  0,
                  5
                )
                .map(
                  (
                    item
                  ) => (
                    <div
                      key={
                        item.id
                      }
                      className="flex items-center justify-between rounded-xl bg-sunken p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-fg">
                          {
                            item.model
                          }
                        </p>

                        <p className="mt-1 text-xs text-fg-subtle">
                          {
                            item.project
                          }{" "}
                          ·{" "}
                          {
                            item.user
                          }
                        </p>
                      </div>

                      <span className="text-xs text-fg-muted">
                        {item.costUsd ==
                        null
                          ? "—"
                          : `$${item.costUsd.toFixed(
                              4
                            )}`}
                      </span>
                    </div>
                  )
                )}

              {!visibleHistory.length && (
                <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-fg-subtle">
                  No
                  generation
                  history
                  yet.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="font-semibold">
              Project
              usage
            </h2>

            <div className="mt-5 space-y-3">
              {projectSpend.map(
                (item) => (
                  <div
                    key={
                      item.name
                    }
                    className="flex items-center justify-between rounded-xl bg-sunken px-4 py-3"
                  >
                    <div>
                      <span className="text-sm text-fg-muted">
                        {
                          item.name
                        }
                      </span>

                      <span className="ml-2 text-xs text-fg-subtle">
                        {
                          item.count
                        }{" "}
                        generations
                      </span>
                    </div>

                    <span className="text-xs text-fg-muted">
                      {item.cost === null
                        ? "—"
                        : `$${item.cost.toFixed(
                            4
                          )}`}
                    </span>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------
  // HISTORY PAGE
  // --------------------------------------------------

  function History() {
    return (
      <div className="space-y-6">
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-fg-subtle">
            Library
          </p>

          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-fg sm:text-[32px]">
            Generation
            History
          </h1>

          <p className="mt-1 text-sm text-fg-muted">
            {currentUser && canManageUsers(currentUser)
              ? "Every generation across the workspace."
              : "Your generations."}
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          {!visibleHistory.length ? (
            <div className="p-12 text-center text-sm text-fg-subtle">
              No generation
              history yet.
            </div>
          ) : (
            <div className="divide-y divide-line">
              {visibleHistory.map(
                (item) => (
                  <div
                    key={
                      item.id
                    }
                    className="grid gap-4 p-5 md:grid-cols-[120px_1fr_auto]"
                  >
                    <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-xl bg-black">
                      {item.outputUrl ? (
  getOutputType(item.outputUrl) === "video" ? (
    <video
      src={item.outputUrl}
      className="h-full w-full object-cover"
      controls
      muted
      playsInline
    />
  ) : (
    <img
      src={item.outputUrl}
      alt="Generated output"
      className="h-full w-full object-cover"
    />
  )
) : (
                        <span className="text-xs text-fg-subtle">
                          {item.status ===
                          "succeeded"
                            ? "No image"
                            : item.status}
                        </span>
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">
                        {
                          item.model
                        }
                      </p>

                      <p className="mt-1 text-xs text-fg-muted">
                        {
                          item.project
                        }{" "}
                        ·{" "}
                        {
                          item.user
                        }
                      </p>

                      <p className="mt-3 line-clamp-2 text-sm text-fg-muted">
                        {item.prompt ||
                          "No prompt"}
                      </p>

                      <p className="mt-3 text-[11px] text-fg-subtle">
                        {new Date(
                          item.createdAt
                        ).toLocaleString()}{" "}
                        ·{" "}
                        {
                          item.predictionId
                        }
                      </p>
                    </div>

                    <div className="flex min-w-28 flex-col items-end justify-between gap-3">
                      <div className="text-right">
                        <p className="text-sm text-fg">
                          {item.costUsd ==
                          null
                            ? "—"
                            : `$${item.costUsd.toFixed(
                                4
                              )}`}
                        </p>

                        <p className="mt-1 text-[10px] uppercase text-fg-subtle">
                          {
                            item.status
                          }
                        </p>
                      </div>

                      {item.outputUrl && (
                        <button
                          type="button"
                          onClick={() =>
                           downloadImage(
  item.outputUrl!,
  `generation-${item.predictionId}.mp4`
)
                          }
                          className="rounded-lg border border-line-strong px-3 py-2 text-xs text-fg hover:bg-raised"
                        >
                          Download
                        </button>
                      )}
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // --------------------------------------------------
  // EXPENSES
  // --------------------------------------------------

  function Expenses() {
    const report = expenseReport;
    const isManagerView = isManager;

    const cards: [string, SpendTotal | undefined][] = [
      ["This month", report?.totals.month],
      ["This week", report?.totals.week],
      ["Today", report?.totals.today],
      ["All time", report?.totals.allTime],
    ];

    const unpricedTotal =
      report?.totals.allTime.unpriced ?? 0;

    return (
      <div className="space-y-6">
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-fg-subtle">
            Spend
          </p>

          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-fg sm:text-[32px]">
            Expenses
          </h1>

          <p className="mt-1 text-sm text-fg-muted">
            {isManagerView
              ? "Workspace AI spend, from the expense ledger."
              : "Your AI spend, from the expense ledger."}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {cards.map(([title, total]) => (
            <div
              key={title}
              className="rounded-2xl border border-line bg-surface p-5"
            >
              <p className="text-xs text-fg-subtle">
                {title}
              </p>

              <p className="mt-3 text-2xl font-semibold">
                {formatUsd(total?.amountUsd)}
              </p>

              <p className="mt-1 text-xs text-fg-subtle">
                {total ? `${total.count} billed` : ""}
              </p>
            </div>
          ))}
        </div>

        {unpricedTotal > 0 && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            {unpricedTotal} billed generation
            {unpricedTotal === 1 ? " has" : "s have"} no
            known price (model not in the price table) and
            {unpricedTotal === 1 ? " is" : " are"} counted
            as $0.
          </div>
        )}

        <div
          className={`grid gap-6 ${
            isManagerView ? "lg:grid-cols-2" : ""
          }`}
        >
          <GroupTable
            title="By project"
            groups={report?.byProject ?? []}
          />

          {isManagerView && (
            <GroupTable
              title="By user"
              groups={report?.byUser ?? []}
            />
          )}
        </div>

        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="border-b border-line px-5 py-4 font-semibold">
            Expense history
          </div>

          {!report ? (
            <div className="p-10 text-center text-sm text-fg-subtle">
              Loading expenses...
            </div>
          ) : !report.entries.length ? (
            <div className="p-10 text-center text-sm text-fg-subtle">
              No expenses yet.
            </div>
          ) : (
            <div className="divide-y divide-line">
              {report.entries.map((item) => (
                <div
                  key={item.id}
                  className="grid gap-3 px-5 py-4 md:grid-cols-5"
                >
                  <span className="text-sm text-fg">
                    {item.project}
                  </span>

                  <span className="text-sm text-fg-muted">
                    {item.user}
                  </span>

                  <span className="truncate text-sm text-fg-muted">
                    {item.model}
                  </span>

                  <span className="text-xs text-fg-subtle">
                    {new Date(
                      item.incurredAt
                    ).toLocaleString()}
                  </span>

                  <span className="text-right text-sm text-fg">
                    {item.amountUsd === null
                      ? "unpriced"
                      : formatUsd(item.amountUsd)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // --------------------------------------------------
  // SETTINGS
  // --------------------------------------------------

  function Settings() {
    return (
      <div className="space-y-6">
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-fg-subtle">
            Account
          </p>

          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-fg sm:text-[32px]">
            Settings
          </h1>

          <p className="mt-1 text-sm text-fg-muted">
            Your account.
          </p>
        </div>

        <div className="grid max-w-xl gap-4 rounded-2xl border border-line bg-surface p-6 sm:grid-cols-3">
          {[
            ["Name", currentUser?.name ?? "—"],
            [
              "Username",
              currentUser
                ? `@${currentUser.username}`
                : "—",
            ],
            [
              "Role",
              currentUser
                ? ROLE_LABELS[currentUser.role]
                : "—",
            ],
          ].map(([title, value]) => (
            <div key={title}>
              <p className="text-[10px] uppercase tracking-wider text-fg-subtle">
                {title}
              </p>

              <p className="mt-1 text-sm text-fg">
                {value}
              </p>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={handleLogout}
          className="rounded-xl border border-line-strong px-4 py-2 text-sm text-fg hover:bg-raised"
        >
          Sign out
        </button>
      </div>
    );
  }

  // --------------------------------------------------
  // GENERATE PAGE
  //
  // Guided flow: 1 Project → 2 Model → 3 Inputs, with a
  // sticky "Run" panel showing the live cost estimate,
  // the Generate button and the output.
  // --------------------------------------------------

  function GeneratePage() {
    const catalogModel = model
      ? findCatalogModel(model)
      : undefined;

    const hasPrompt = Object.prototype.hasOwnProperty.call(
      schema,
      "prompt"
    );

    const hasAspectRatio =
      model === "google/nano-banana-2" ||
      Object.prototype.hasOwnProperty.call(
        schema,
        "aspect_ratio"
      );

    const hasResolution =
      model === "google/nano-banana-2" ||
      Object.prototype.hasOwnProperty.call(
        schema,
        "resolution"
      );

    const aspectRatioOptions =
      schema.aspect_ratio?.enum ?? ASPECT_RATIOS;

    const resolutionOptions =
      schema.resolution?.enum ?? ["1K", "2K", "4K"];

    const mediaFields = orderedFields.filter(
      ([key, field]) => fieldGroup(key, field) === "media"
    );
    const mainFields = orderedFields.filter(
      ([key, field]) => fieldGroup(key, field) === "main"
    );
    const advancedFields = orderedFields.filter(
      ([key, field]) => fieldGroup(key, field) === "advanced"
    );

    const visibleCatalog = MODEL_CATALOG.filter(
      (item) =>
        catalogFilter === "all" || item.kind === catalogFilter
    );

    // ---------- Cost preview ----------
    // Same price table the server uses after the run;
    // priced from exactly the inputs Generate will send.

    let estimate: number | null = null;

    if (model && catalogModel && !schemaLoading) {
      try {
        estimate = calculateReplicateCost(model, {
          status: "succeeded",
          input: buildGenerationInputs(inputs),
        });
      } catch {
        estimate = null;
      }
    }

    const estimateDetail = [
      inputs.resolution ? String(inputs.resolution) : "",
      inputs.duration ? `${inputs.duration}s` : "",
      inputs.quality ? `${inputs.quality} quality` : "",
    ]
      .filter(Boolean)
      .join(" · ");

    // ---------- Readiness ----------

    const uploadsInFlight = Object.values(uploading).some(
      (count) => count > 0
    );

    const missing = [
      !project && "choose a project",
      !model && "choose a model",
      uploadsInFlight && "wait for uploads to finish",
    ].filter(Boolean) as string[];

    const canGenerate =
      missing.length === 0 && !generating && !schemaLoading;

    // ---------- Output ----------

    const status = result?.prediction.status;
    const isRunning =
      generating ||
      status === "starting" ||
      status === "processing" ||
      status === "queued";

    const outputUrls = getOutputUrls(
      result?.prediction?.output
    );

    const predictTime =
      result?.prediction.metrics?.predict_time;

    const projectHint = !projects.length
      ? currentUser && canManageProjects(currentUser)
        ? "No projects yet. Create one in Users & Projects."
        : "No projects yet. Ask an admin to create one."
      : "Spend from this run is charged to the project.";

    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Create"
          title="Generate"
          description="Create images and video. Every run is costed and charged to a project."
        />

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          {/* ================= LEFT: STEPS ================= */}
          <div className="min-w-0 space-y-4">
            {/* STEP 1: PROJECT */}
            <Card className="p-5">
              <StepHeader
                step={1}
                title="Project"
                description="Who pays for this run."
                done={Boolean(project)}
              />

              <div className="mt-4 flex max-w-md items-start gap-3">
                {/* Offset = Field label + gap, so it lines up
                    with the select, not the hint below it */}
                <ProjectAvatar
                  name={project}
                  imageUrl={
                    projectList.find(
                      (item) => item.name === project
                    )?.imageUrl
                  }
                  size={40}
                  className="mt-[26px]"
                />

                <div className="min-w-0 flex-1">
                <Field label="Project" required hint={projectHint}>
                  {(control) => (
                    <select
                      {...control}
                      value={project}
                      onChange={(event) =>
                        setProject(event.target.value)
                      }
                      className={cx(
                        inputClass,
                        !project && "text-fg-subtle"
                      )}
                    >
                      <option value="" disabled>
                        Select project
                      </option>

                      {projects.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                </div>
              </div>
            </Card>

            {/* STEP 2: MODEL */}
            <Card className="p-5">
              <StepHeader
                step={2}
                title="Model"
                description="Approved models have known prices, so spend is tracked exactly."
                done={Boolean(model)}
              />

              <div
                role="group"
                aria-label="Filter models by type"
                className="mt-4 flex flex-wrap gap-1.5"
              >
                {(
                  [
                    ["all", "All"],
                    ["image", KIND_LABELS.image],
                    ["video", KIND_LABELS.video],
                    ["upscale", KIND_LABELS.upscale],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={catalogFilter === value}
                    onClick={() => setCatalogFilter(value)}
                    className={cx(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      catalogFilter === value
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-line text-fg-muted hover:border-line-strong hover:text-fg"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                {visibleCatalog.map((item) => {
                  const selected = model === item.id;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => chooseModel(item.id)}
                      className={cx(
                        "flex items-start gap-3 rounded-lg border p-3.5 text-left transition-colors",
                        selected
                          ? "border-accent bg-accent-soft ring-1 ring-accent"
                          : "border-line bg-sunken hover:border-line-strong"
                      )}
                    >
                      <span
                        className={cx(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                          selected
                            ? "bg-accent text-on-accent"
                            : "bg-raised text-fg-muted"
                        )}
                      >
                        <Icon
                          name={
                            item.kind === "upscale"
                              ? "upscale"
                              : item.kind
                          }
                          size={17}
                        />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-fg">
                            {item.label}
                          </span>

                          {selected && (
                            <Icon
                              name="check"
                              size={16}
                              className="text-accent"
                              label="Selected"
                            />
                          )}
                        </span>

                        <span className="mt-0.5 block text-xs text-fg-subtle">
                          {item.vendor} · {item.summary}
                        </span>

                        <span className="mt-2 inline-block font-mono text-xs text-fg-muted">
                          {item.priceHint}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Selected model from outside the catalog */}
              {model && !catalogModel && (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3.5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">
                      {model}
                    </p>
                    <p className="mt-0.5 text-xs text-warning">
                      Unpriced model: runs are recorded in
                      Expenses as unpriced ($0).
                    </p>
                  </div>

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => chooseModel("")}
                  >
                    Clear
                  </Button>
                </div>
              )}

              {/* Escape hatch: any Replicate model */}
              <div className="mt-4 border-t border-line pt-4">
                <button
                  type="button"
                  aria-expanded={showOtherModels}
                  onClick={() =>
                    setShowOtherModels((open) => !open)
                  }
                  className="flex items-center gap-1.5 text-sm font-medium text-fg-muted hover:text-fg"
                >
                  <Icon
                    name="chevronDown"
                    size={16}
                    className={cx(
                      "transition-transform",
                      showOtherModels ? "" : "-rotate-90"
                    )}
                  />
                  Use another Replicate model
                </button>

                {showOtherModels && (
                  <div className="mt-3 space-y-3">
                    <Alert tone="warning">
                      Models outside the approved list have no
                      price on file. Their spend can&apos;t be
                      tracked.
                    </Alert>

                    <div className="relative">
                      <Icon
                        name="search"
                        size={16}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
                      />

                      <input
                        type="search"
                        value={search}
                        onChange={(event) =>
                          setSearch(event.target.value)
                        }
                        placeholder="Search Replicate, e.g. flux or whisper"
                        aria-label="Search Replicate models"
                        className={cx(inputClass, "pl-9")}
                      />
                    </div>

                    {loadingModels ? (
                      <p className="flex items-center gap-2 text-sm text-fg-muted">
                        <Spinner /> Searching…
                      </p>
                    ) : search.trim() && search !== model ? (
                      models.length ? (
                        <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">
                          {models.map((item) => (
                            <li key={item.id}>
                              <button
                                type="button"
                                onClick={() =>
                                  selectModel(item)
                                }
                                className="block w-full px-3.5 py-3 text-left transition-colors hover:bg-raised"
                              >
                                <span className="flex items-center justify-between gap-2">
                                  <span className="truncate text-sm font-medium text-fg">
                                    {item.id}
                                  </span>

                                  {findCatalogModel(item.id) ? (
                                    <Badge tone="success">
                                      Approved
                                    </Badge>
                                  ) : (
                                    <Badge tone="warning">
                                      Unpriced
                                    </Badge>
                                  )}
                                </span>

                                {item.description && (
                                  <span className="mt-0.5 line-clamp-2 block text-xs text-fg-subtle">
                                    {item.description}
                                  </span>
                                )}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-fg-subtle">
                          No models match “{search.trim()}”.
                        </p>
                      )
                    ) : null}
                  </div>
                )}
              </div>
            </Card>

            {/* STEP 3: INPUTS */}
            {model && (
              <Card className="p-5">
                <StepHeader
                  step={3}
                  title="Inputs"
                  description={
                    catalogModel
                      ? `Settings for ${catalogModel.label}.`
                      : "Settings for the selected model."
                  }
                />

                {schemaLoading ? (
                  <div
                    className="mt-5 space-y-3"
                    aria-busy="true"
                    aria-label="Loading model settings"
                  >
                    <div className="h-24 animate-pulse rounded-lg bg-raised" />
                    <div className="h-10 w-2/3 animate-pulse rounded-lg bg-raised" />
                    <div className="h-10 w-1/2 animate-pulse rounded-lg bg-raised" />
                  </div>
                ) : (
                  // Remount per model so uncontrolled text
                  // areas reset with the new defaults
                  <div key={model} className="mt-5 space-y-5">
                    {hasPrompt && (
                      <Field
                        label="Prompt"
                        required
                        hint="Describe what you want to create. Be specific about subject, style and lighting."
                      >
                        {(control) => (
                          <StableTextArea
                            {...control}
                            rows={5}
                            value={String(inputs.prompt ?? "")}
                            onChange={(next) =>
                              updateInput("prompt", next)
                            }
                            placeholder="A product photo of a ceramic mug on a marble counter, soft morning light…"
                            className={textareaClass}
                          />
                        )}
                      </Field>
                    )}

                    {(hasAspectRatio || hasResolution) && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        {hasAspectRatio && (
                          <Field label="Aspect ratio">
                            {(control) => (
                              <select
                                {...control}
                                value={String(
                                  inputs.aspect_ratio ??
                                    aspectRatioOptions[0]
                                )}
                                onChange={(event) =>
                                  updateInput(
                                    "aspect_ratio",
                                    event.target.value
                                  )
                                }
                                className={inputClass}
                              >
                                {aspectRatioOptions.map((ratio) => (
                                  <option key={ratio} value={ratio}>
                                    {ratio === "match_input_image"
                                      ? "Match input image"
                                      : ratio}
                                  </option>
                                ))}
                              </select>
                            )}
                          </Field>
                        )}

                        {hasResolution && (
                          <Field
                            label="Resolution"
                            hint="Higher resolution costs more."
                          >
                            {(control) => (
                              <select
                                {...control}
                                value={String(
                                  inputs.resolution ??
                                    resolutionOptions[0]
                                )}
                                onChange={(event) =>
                                  updateInput(
                                    "resolution",
                                    event.target.value
                                  )
                                }
                                className={inputClass}
                              >
                                {resolutionOptions.map((value) => (
                                  <option key={value} value={value}>
                                    {value}
                                  </option>
                                ))}
                              </select>
                            )}
                          </Field>
                        )}
                      </div>
                    )}

                    {mediaFields.map(([key, field]) =>
                      renderField(key, field)
                    )}

                    {mainFields.length > 0 && (
                      <div className="grid gap-5 sm:grid-cols-2">
                        {mainFields.map(([key, field]) => (
                          <div
                            key={key}
                            className={cx(
                              // Long text and toggles span both columns
                              (field.type === "boolean" ||
                                /description|negative/i.test(key)) &&
                                "sm:col-span-2"
                            )}
                          >
                            {renderField(key, field)}
                          </div>
                        ))}
                      </div>
                    )}

                    {advancedFields.length > 0 && (
                      <details className="group rounded-lg border border-line">
                        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-fg-muted hover:text-fg">
                          <span>
                            Advanced settings
                            <span className="ml-1.5 text-fg-subtle">
                              ({advancedFields.length})
                            </span>
                          </span>

                          <Icon
                            name="chevronDown"
                            size={16}
                            className="transition-transform group-open:rotate-180"
                          />
                        </summary>

                        <div className="space-y-5 border-t border-line p-4">
                          {advancedFields.map(([key, field]) =>
                            renderField(key, field)
                          )}
                        </div>
                      </details>
                    )}

                    {!hasPrompt &&
                      !hasAspectRatio &&
                      !hasResolution &&
                      orderedFields.length === 0 && (
                        <p className="text-sm text-fg-subtle">
                          This model has no settings.
                        </p>
                      )}
                  </div>
                )}
              </Card>
            )}
          </div>

          {/* ================= RIGHT: RUN + OUTPUT ================= */}
          <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
            {/* RUN */}
            <Card className="p-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-fg-subtle">
                Estimated cost
              </p>

              <div className="mt-2" aria-live="polite">
                {!model ? (
                  <p className="text-sm text-fg-muted">
                    Choose a model to see its price.
                  </p>
                ) : !catalogModel ? (
                  <>
                    <p className="text-2xl font-semibold text-warning">
                      Unpriced
                    </p>
                    <p className="mt-1 text-xs text-fg-subtle">
                      No price on file for this model.
                    </p>
                  </>
                ) : schemaLoading ? (
                  <div className="h-8 w-28 animate-pulse rounded-md bg-raised" />
                ) : estimate !== null ? (
                  <>
                    <p className="font-mono text-3xl font-semibold tracking-tight text-fg">
                      ≈ {formatCost(estimate)}
                    </p>
                    <p className="mt-1 text-xs text-fg-subtle">
                      per run
                      {estimateDetail
                        ? ` · ${estimateDetail}`
                        : ""}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-mono text-lg font-semibold text-fg">
                      {catalogModel.priceHint}
                    </p>
                    <p className="mt-1 text-xs text-fg-subtle">
                      Exact cost depends on the output size.
                    </p>
                  </>
                )}
              </div>

              <dl className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-fg-subtle">Project</dt>
                  <dd className="truncate text-right font-medium text-fg">
                    {project || "—"}
                  </dd>
                </div>

                <div className="flex justify-between gap-3">
                  <dt className="text-fg-subtle">Model</dt>
                  <dd className="truncate text-right font-medium text-fg">
                    {catalogModel?.label || model || "—"}
                  </dd>
                </div>
              </dl>

              <Button
                variant="primary"
                size="lg"
                icon={generating ? undefined : "sparkles"}
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="mt-5 w-full"
              >
                {generating ? (
                  <>
                    <Spinner /> Starting…
                  </>
                ) : (
                  "Generate"
                )}
              </Button>

              {missing.length > 0 && !generating && (
                <p className="mt-2 text-center text-xs text-fg-subtle">
                  To continue, {missing.join(" and ")}.
                </p>
              )}

              {error && (
                <div className="mt-4">
                  <Alert>{error}</Alert>
                </div>
              )}
            </Card>

            {/* OUTPUT */}
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                <h2 className="text-sm font-semibold text-fg">
                  Output
                </h2>

                {status && (
                  <Badge
                    tone={
                      status === "succeeded"
                        ? "success"
                        : status === "failed" ||
                            status === "canceled"
                          ? "danger"
                          : "accent"
                    }
                  >
                    {status}
                  </Badge>
                )}
              </div>

              <div className="p-4" aria-live="polite">
                {isRunning ? (
                  <div className="flex min-h-72 flex-col items-center justify-center rounded-lg bg-sunken text-center">
                    <Spinner className="h-6 w-6 text-accent" />

                    <p className="mt-4 text-sm font-medium text-fg">
                      Generating…
                    </p>

                    <p className="mt-1 max-w-xs text-xs text-fg-subtle">
                      Video can take a few minutes. You can
                      leave this page; the result is saved to
                      History.
                    </p>
                  </div>
                ) : status === "succeeded" &&
                  outputUrls.length > 0 ? (
                  <div className="space-y-3">
                    {outputUrls.map((url, index) => {
                      const outputType = getOutputType(url);

                      return (
                        <div
                          key={`${url}-${index}`}
                          className="overflow-hidden rounded-lg border border-line bg-black"
                        >
                          {outputType === "video" ? (
                            <video
                              src={url}
                              className="w-full"
                              controls
                              muted
                              playsInline
                            />
                          ) : outputType === "audio" ? (
                            <audio
                              src={url}
                              controls
                              className="w-full"
                            />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={url}
                              alt={`Generated output ${index + 1}`}
                              className="max-h-[560px] w-full object-contain"
                            />
                          )}
                        </div>
                      );
                    })}

                    <div className="flex flex-wrap gap-2">
                      {outputUrls.map((url, index) => (
                        <Button
                          key={`download-${index}`}
                          variant="secondary"
                          size="sm"
                          icon="download"
                          onClick={() =>
                            downloadImage(
                              url,
                              outputUrls.length > 1
                                ? `generation-${result!.prediction.id}-${index + 1}`
                                : `generation-${result!.prediction.id}`
                            )
                          }
                        >
                          Download
                          {outputUrls.length > 1
                            ? ` ${index + 1}`
                            : ""}
                        </Button>
                      ))}
                    </div>

                    <dl className="grid grid-cols-2 gap-3 rounded-lg bg-sunken p-3.5 text-xs">
                      <div>
                        <dt className="text-fg-subtle">Cost</dt>
                        <dd className="mt-0.5 font-mono font-medium text-fg">
                          {formatCost(result?.costUsd)}
                        </dd>
                      </div>

                      <div>
                        <dt className="text-fg-subtle">Run time</dt>
                        <dd className="mt-0.5 font-medium text-fg">
                          {typeof predictTime === "number"
                            ? `${predictTime.toFixed(1)}s`
                            : "—"}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ) : status === "failed" ||
                  status === "canceled" ? (
                  <Alert>
                    <p className="font-medium">
                      Generation {status}
                    </p>
                    <p className="mt-0.5 text-xs opacity-90">
                      {result?.prediction.error ||
                        "The model couldn't complete this run. Failed runs aren't added to Expenses."}
                    </p>
                  </Alert>
                ) : (
                  <EmptyState
                    icon="image"
                    title="Nothing generated yet"
                    description="Your result will appear here. It's also saved to History."
                  />
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------
  // NAVIGATION
  //
  // Grouped by job: Create → Library → Spend → Admin.
  // Admin only appears for admins and the super admin.
  // --------------------------------------------------

  const navGroups: {
    label: string;
    items: { id: Page; label: string; icon: IconName }[];
  }[] = [
    {
      label: "Create",
      items: [
        { id: "generate", label: "Generate", icon: "sparkles" },
      ],
    },
    {
      label: "Library",
      items: [
        { id: "history", label: "History", icon: "history" },
      ],
    },
    {
      label: "Spend",
      items: [
        { id: "dashboard", label: "Dashboard", icon: "chart" },
        { id: "expenses", label: "Expenses", icon: "wallet" },
      ],
    },
    ...(isManager
      ? [
          {
            label: "Admin",
            items: [
              {
                id: "users" as Page,
                label:
                  currentUser && canManageProjects(currentUser)
                    ? "Users & Projects"
                    : "Users",
                icon: "users" as IconName,
              },
            ],
          },
        ]
      : []),
  ];

  const pageTitles: Record<Page, string> = {
    generate: "Generate",
    history: "History",
    dashboard: "Dashboard",
    expenses: "Expenses",
    users: "Users & Projects",
    settings: "Account",
  };

  function goTo(next: Page) {
    setPage(next);
    setNavOpen(false);
  }

  // --------------------------------------------------
  // PAGE CONTENT
  // --------------------------------------------------

  function renderPage() {
    switch (page) {
      case "dashboard":
        return Dashboard();

      case "history":
        return History();

      case "expenses":
        return Expenses();

      case "users":
        return currentUser && isManager ? (
          <ManagementPage
            currentUser={currentUser}
            onProjectsChanged={refreshProjects}
          />
        ) : (
          GeneratePage()
        );

      case "settings":
        return Settings();

      case "generate":
      default:
        return GeneratePage();
    }
  }

  // Sidebar body, shared by the desktop rail and the
  // mobile drawer
  function renderNav() {
    return (
      <div className="flex h-full flex-col">
        {/* Brand lockup: naar wordmark + "Studio" */}
        <button
          type="button"
          onClick={() => goTo("generate")}
          aria-label="Naar Studio home"
          className="flex h-16 items-center gap-2 px-5 text-fg"
        >
          <NaarLogo height={24} />
          <span className="pt-0.5 text-[15px] font-medium tracking-tight text-fg-muted">
            Studio
          </span>
        </button>

        <nav
          aria-label="Main"
          className="flex-1 space-y-6 overflow-y-auto px-3 py-3"
        >
          {navGroups.map((group) => (
            <div key={group.label}>
              <p className="px-2.5 pb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-fg-subtle">
                {group.label}
              </p>

              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = page === item.id;

                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => goTo(item.id)}
                        aria-current={active ? "page" : undefined}
                        className={cx(
                          "relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                          active
                            ? "bg-accent-soft font-medium text-accent"
                            : "text-fg-muted hover:bg-raised hover:text-fg"
                        )}
                      >
                        {/* NAAR cyan marker on the active page */}
                        {active && (
                          <span
                            aria-hidden
                            className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-brand"
                          />
                        )}
                        <Icon name={item.icon} size={17} />
                        {item.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Signed-in user */}
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-raised text-xs font-semibold text-fg"
              aria-hidden
            >
              {user.charAt(0).toUpperCase() || "?"}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-fg">
                {user || "…"}
              </span>
              <span className="block truncate text-xs text-fg-subtle">
                {currentUser
                  ? ROLE_LABELS[currentUser.role]
                  : ""}
              </span>
            </span>
          </div>

          <div className="mt-1 grid grid-cols-2 gap-1">
            <Button
              size="sm"
              variant="ghost"
              icon="settings"
              onClick={() => goTo("settings")}
              aria-current={
                page === "settings" ? "page" : undefined
              }
            >
              Account
            </Button>

            <Button
              size="sm"
              variant="ghost"
              icon="logout"
              onClick={handleLogout}
            >
              Sign out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------
  // MAIN
  // --------------------------------------------------

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>

      {/* DESKTOP SIDEBAR */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-line bg-surface lg:block">
        {renderNav()}
      </aside>

      {/* MOBILE DRAWER */}
      {navOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          onKeyDown={(event) => {
            if (event.key === "Escape") setNavOpen(false);
          }}
        >
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/40"
            onClick={() => setNavOpen(false)}
          />

          <aside className="relative h-full w-72 max-w-[85vw] border-r border-line bg-surface shadow-xl">
            <Button
              size="sm"
              variant="ghost"
              icon="close"
              aria-label="Close navigation"
              autoFocus
              onClick={() => setNavOpen(false)}
              className="absolute right-2 top-3"
            />
            {renderNav()}
          </aside>
        </div>
      )}

      <div className="lg:pl-60">
        {/* TOP BAR */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-line bg-canvas/90 px-4 backdrop-blur lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              icon="menu"
              aria-label="Open navigation"
              aria-expanded={navOpen}
              onClick={() => setNavOpen(true)}
              className="lg:hidden"
            />

            <p className="truncate text-sm font-medium text-fg-muted">
              {pageTitles[page]}
            </p>
          </div>

          <ThemeToggle />
        </header>

        <main
          id="main-content"
          className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8 lg:py-8"
        >
          {renderPage()}
        </main>
      </div>
    </div>
  );
}
