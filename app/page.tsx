"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ManagementPage from "@/app/components/ManagementPage";
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
  | "projects"
  | "models"
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

function StableTextArea({
  value,
  onChange,
  placeholder,
  rows = 6,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}) {
  return (
    <textarea
      rows={rows}
      defaultValue={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={className}
      autoComplete="off"
      spellCheck={false}
    />
  );
}

function formatUsd(amount: number | null | undefined) {
  return amount === null || amount === undefined
    ? "—"
    : `$${amount.toFixed(4)}`;
}

// Spend grouped by project or user (Expenses page)
function GroupTable({
  title,
  groups,
}: {
  title: string;
  groups: SpendGroup[];
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/70">
      <div className="border-b border-zinc-800 px-5 py-4 font-semibold">
        {title}
      </div>

      {!groups.length ? (
        <div className="p-8 text-center text-sm text-zinc-600">
          No spend yet.
        </div>
      ) : (
        <div className="divide-y divide-zinc-800">
          {groups.map((group) => (
            <div
              key={group.id}
              className="flex items-center justify-between gap-3 px-5 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-zinc-300">
                  {group.name}
                </p>

                <p className="mt-0.5 text-xs text-zinc-600">
                  {group.count} billed
                  {group.unpriced
                    ? ` · ${group.unpriced} unpriced`
                    : ""}
                </p>
              </div>

              <span className="text-sm text-zinc-300">
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

  // Active projects from MongoDB (managed by the super admin)
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

  const [modelDropdownOpen, setModelDropdownOpen] =
    useState(false);

  const modelBoxRef =
    useRef<HTMLDivElement>(null);

  const [schema, setSchema] =
    useState<Schema>({});

  const [inputs, setInputs] =
    useState<Record<string, unknown>>({});
const [filePreviews, setFilePreviews] =
  useState<Record<string, string[]>>({});
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

  // Called after the super admin edits projects
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
  // LOAD ALL MODELS
  // --------------------------------------------------

  async function loadAllModels() {
    try {
      setLoadingModels(true);
      setError("");

      const response =
        await fetch("/api/models", {
          cache: "no-store",
        });

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Unable to load models"
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
        "Unable to load models."
      );
    } finally {
      setLoadingModels(false);
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

          setModelDropdownOpen(true);
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
  // OUTSIDE CLICK
  // --------------------------------------------------

  useEffect(() => {
    function handleOutsideClick(
      event: MouseEvent
    ) {
      if (
        modelBoxRef.current &&
        !modelBoxRef.current.contains(
          event.target as Node
        )
      ) {
        setModelDropdownOpen(false);
      }
    }

    document.addEventListener(
      "mousedown",
      handleOutsideClick
    );

    return () =>
      document.removeEventListener(
        "mousedown",
        handleOutsideClick
      );
  }, []);

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

    setModelDropdownOpen(
      false
    );

    setResult(null);
    setError("");
  }

  // --------------------------------------------------
  // FILE TO DATA URL
  // --------------------------------------------------

  function fileToDataUrl(
    file: File
  ): Promise<string> {
    return new Promise(
      (resolve, reject) => {
        const reader =
          new FileReader();

        reader.onload = () => {
          resolve(
            String(
              reader.result
            )
          );
        };

        reader.onerror =
          reject;

        reader.readAsDataURL(
          file
        );
      }
    );
  }

  // --------------------------------------------------
  // FILE UPLOAD
  // --------------------------------------------------

 async function handleFileUpload(
  key: string,
  file?: File
) {
  if (!file) return;

  try {
    setError("");

    // VIDEO
    if (file.type.startsWith("video/")) {
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

      const generationInputs: Record<string, unknown> = {
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
  // --------------------------------------------------

  function renderField(
    key: string,
    field: SchemaProperty
  ) {
    const value =
      inputs[key];

    const label =
      field.title ||
      key
        .replace(
          /_/g,
          " "
        )
        .replace(
          /\b\w/g,
          (letter) =>
            letter.toUpperCase()
        );

    const lowerKey =
      key.toLowerCase();

    const isFile =
  field.format === "uri" ||
  lowerKey.includes("image") ||
  (lowerKey.includes("video") &&
    !lowerKey.includes("reference_type")) ||
  lowerKey.includes("audio");

    const isLong =
      lowerKey ===
        "prompt" ||
      lowerKey.includes(
        "description"
      ) ||
      lowerKey.includes(
        "negative"
      );

    // ENUM
    if (field.enum?.length) {
      return (
        <div
          key={key}
          className="space-y-2"
        >
          <label className="text-sm font-medium text-zinc-300">
            {label}
          </label>

          {field.description && (
            <p className="text-xs text-zinc-600">
              {field.description}
            </p>
          )}

          <select
            value={String(
              value ?? ""
            )}
            onChange={(
              event
            ) =>
              updateInput(
                key,
                event.target
                  .value
              )
            }
            className="h-11 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm outline-none focus:border-zinc-500"
          >
            {field.enum.map(
              (option) => (
                <option
                  key={
                    option
                  }
                  value={
                    option
                  }
                >
                  {option}
                </option>
              )
            )}
          </select>
        </div>
      );
    }

    // BOOLEAN
    if (
      field.type ===
      "boolean"
    ) {
      return (
        <label
          key={key}
          className="flex cursor-pointer gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4"
        >
          <input
            type="checkbox"
            checked={Boolean(
              value
            )}
            onChange={(
              event
            ) =>
              updateInput(
                key,
                event.target
                  .checked
              )
            }
            className="mt-1 h-4 w-4"
          />

          <div>
            <p className="text-sm text-zinc-300">
              {label}
            </p>

            {field.description && (
              <p className="mt-1 text-xs text-zinc-600">
                {
                  field.description
                }
              </p>
            )}
          </div>
        </label>
      );
    }

    // NUMBER
    if (
      field.type ===
        "number" ||
      field.type ===
        "integer"
    ) {
      return (
        <div
          key={key}
          className="space-y-2"
        >
          <label className="text-sm text-zinc-300">
            {label}
          </label>

          <input
            type="number"
            value={
              value === ""
                ? ""
                : String(
                    value ??
                      ""
                  )
            }
            min={
              field.minimum
            }
            max={
              field.maximum
            }
            onChange={(
              event
            ) =>
              updateInput(
                key,
                event.target
                  .value ===
                  ""
                  ? ""
                  : Number(
                      event
                        .target
                        .value
                    )
              )
            }
            className="h-11 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm outline-none focus:border-zinc-500"
          />
        </div>
      );
    }

    // FILE
    // FILE
if (isFile) {
  const isVideo =
    lowerKey.includes("video");

  const images = Array.isArray(value)
    ? value
    : typeof value === "string" &&
      value.length > 0
      ? [value]
      : [];

  const hasVideo =
    isVideo &&
    typeof value === "string" &&
    value.length > 0;

  return (
    <div
      key={key}
      className="space-y-3"
    >
      <label className="text-sm font-medium text-zinc-300">
        {label}
      </label>

      <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 hover:border-zinc-600">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 text-xl">
          +
        </div>

        <p className="text-sm text-zinc-300">
          Upload {label}
        </p>

        <p className="mt-1 text-xs text-zinc-600">
          PNG or JPG
        </p>

        <input
          type="file"
          accept={
            isVideo
              ? "video/*"
              : "image/*"
          }
          multiple={!isVideo}
          className="hidden"
          onChange={(event) => {
            const files =
              event.target.files;

            if (!files) return;

            Array.from(files).forEach(
              (file) => {
                handleFileUpload(
                  key,
                  file
                );
              }
            );

            event.target.value = "";
          }}
        />
      </label>

      {/* VIDEO PREVIEW */}
      {hasVideo && (
        <div className="relative">
          <video
            src={String(value)}
            controls
            playsInline
            className="max-h-72 w-full rounded-2xl border border-zinc-800 object-contain bg-black"
          />

          <button
            type="button"
            onClick={() =>
              updateInput(
                key,
                ""
              )
            }
            className="absolute right-3 top-3 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            Cancel
          </button>
        </div>
      )}

      {/* IMAGE PREVIEW */}
      {!isVideo &&
        images.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {images.map(
              (image, index) => (
                <div
                  key={index}
                  className="relative"
                >
                  <img
                    src={
  filePreviews[key]?.[index] ??
  String(image)
}
                    alt={`Input ${
                      index + 1
                    }`}
                    className="h-40 w-full rounded-2xl border border-zinc-800 object-contain bg-black"
                  />

                  <button
                    type="button"
                    onClick={() => {
                      const updatedImages =
                        images.filter(
                          (_, i) =>
                            i !== index
                        );

                      updateInput(
                        key,
                        updatedImages
                      );
                    }}
                    className="absolute right-2 top-2 rounded-lg bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                  >
                    Cancel
                  </button>
                </div>
              )
            )}
          </div>
        )}
    </div>
  );
}

    // LONG TEXT
    if (isLong) {
      return (
        <div
          key={key}
          className="space-y-2"
        >
          <label className="text-sm font-medium text-zinc-300">
            {label}
          </label>

          {field.description && (
            <p className="text-xs text-zinc-600">
              {
                field.description
              }
            </p>
          )}

          <StableTextArea
            rows={7}
            value={String(
              value ?? ""
            )}
            onChange={(
              next
            ) =>
              updateInput(
                key,
                next
              )
            }
            placeholder={`Enter ${label.toLowerCase()}...`}
            className="w-full resize-none rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm outline-none focus:border-zinc-500"
          />
        </div>
      );
    }

    // NORMAL TEXT
    return (
      <div
        key={key}
        className="space-y-2"
      >
        <label className="text-sm text-zinc-300">
          {label}
        </label>

        <input
          value={String(
            value ?? ""
          )}
          onChange={(
            event
          ) =>
            updateInput(
              key,
              event.target
                .value
            )
          }
          className="h-11 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm outline-none focus:border-zinc-500"
        />
      </div>
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
          <h1 className="text-2xl font-semibold">
            Dashboard
          </h1>

          <p className="mt-1 text-sm text-zinc-500">
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
                className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5"
              >
                <p className="text-xs uppercase tracking-wider text-zinc-600">
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
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
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
                      className="flex items-center justify-between rounded-xl bg-zinc-950 p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-zinc-300">
                          {
                            item.model
                          }
                        </p>

                        <p className="mt-1 text-xs text-zinc-600">
                          {
                            item.project
                          }{" "}
                          ·{" "}
                          {
                            item.user
                          }
                        </p>
                      </div>

                      <span className="text-xs text-zinc-500">
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
                <p className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-600">
                  No
                  generation
                  history
                  yet.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
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
                    className="flex items-center justify-between rounded-xl bg-zinc-950 px-4 py-3"
                  >
                    <div>
                      <span className="text-sm text-zinc-400">
                        {
                          item.name
                        }
                      </span>

                      <span className="ml-2 text-xs text-zinc-700">
                        {
                          item.count
                        }{" "}
                        generations
                      </span>
                    </div>

                    <span className="text-xs text-zinc-500">
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
          <h1 className="text-2xl font-semibold">
            Generation
            History
          </h1>

          <p className="mt-1 text-sm text-zinc-500">
            {currentUser && canManageUsers(currentUser)
              ? "Every generation across the workspace."
              : "Your generations."}
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/70">
          {!visibleHistory.length ? (
            <div className="p-12 text-center text-sm text-zinc-600">
              No generation
              history yet.
            </div>
          ) : (
            <div className="divide-y divide-zinc-800">
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
                        <span className="text-xs text-zinc-700">
                          {item.status ===
                          "succeeded"
                            ? "No image"
                            : item.status}
                        </span>
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-200">
                        {
                          item.model
                        }
                      </p>

                      <p className="mt-1 text-xs text-zinc-500">
                        {
                          item.project
                        }{" "}
                        ·{" "}
                        {
                          item.user
                        }
                      </p>

                      <p className="mt-3 line-clamp-2 text-sm text-zinc-400">
                        {item.prompt ||
                          "No prompt"}
                      </p>

                      <p className="mt-3 text-[11px] text-zinc-600">
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
                        <p className="text-sm text-zinc-300">
                          {item.costUsd ==
                          null
                            ? "—"
                            : `$${item.costUsd.toFixed(
                                4
                              )}`}
                        </p>

                        <p className="mt-1 text-[10px] uppercase text-zinc-600">
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
                          className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800"
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
          <h1 className="text-2xl font-semibold">
            Expenses
          </h1>

          <p className="mt-1 text-sm text-zinc-500">
            {isManagerView
              ? "Workspace AI spend, from the expense ledger."
              : "Your AI spend, from the expense ledger."}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {cards.map(([title, total]) => (
            <div
              key={title}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5"
            >
              <p className="text-xs text-zinc-600">
                {title}
              </p>

              <p className="mt-3 text-2xl font-semibold">
                {formatUsd(total?.amountUsd)}
              </p>

              <p className="mt-1 text-xs text-zinc-600">
                {total ? `${total.count} billed` : ""}
              </p>
            </div>
          ))}
        </div>

        {unpricedTotal > 0 && (
          <div className="rounded-xl border border-amber-900 bg-amber-950/20 px-4 py-3 text-sm text-amber-300">
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

        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/70">
          <div className="border-b border-zinc-800 px-5 py-4 font-semibold">
            Expense history
          </div>

          {!report ? (
            <div className="p-10 text-center text-sm text-zinc-600">
              Loading expenses...
            </div>
          ) : !report.entries.length ? (
            <div className="p-10 text-center text-sm text-zinc-600">
              No expenses yet.
            </div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {report.entries.map((item) => (
                <div
                  key={item.id}
                  className="grid gap-3 px-5 py-4 md:grid-cols-5"
                >
                  <span className="text-sm text-zinc-300">
                    {item.project}
                  </span>

                  <span className="text-sm text-zinc-500">
                    {item.user}
                  </span>

                  <span className="truncate text-sm text-zinc-500">
                    {item.model}
                  </span>

                  <span className="text-xs text-zinc-600">
                    {new Date(
                      item.incurredAt
                    ).toLocaleString()}
                  </span>

                  <span className="text-right text-sm text-zinc-300">
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
  // PROJECTS
  // --------------------------------------------------

  function Projects() {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">
            Projects
          </h1>

          <p className="mt-1 text-sm text-zinc-500">
            Manage your AI
            projects.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map(
            (item) => (
              <div
                key={item}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-800">
                    {item.charAt(
                      0
                    )}
                  </div>

                  <span className="text-xs text-zinc-600">
                    Active
                  </span>
                </div>

                <h2 className="mt-5 font-semibold">
                  {item}
                </h2>

                <p className="mt-1 text-xs text-zinc-600">
                  {
                    visibleHistory.filter(
                      (
                        entry
                      ) =>
                        entry.project ===
                        item
                    ).length
                  }{" "}
                  generations
                </p>
              </div>
            )
          )}
        </div>
      </div>
    );
  }

  // --------------------------------------------------
  // MODELS
  // --------------------------------------------------

  function ModelsPage() {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">
            Models
          </h1>

          <p className="mt-1 text-sm text-zinc-500">
            Browse available
            AI models.
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
          <button
            type="button"
            onClick={
              loadAllModels
            }
            className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200"
          >
            {loadingModels
              ? "Loading..."
              : "Load Models"}
          </button>

          <div className="mt-5 space-y-2">
            {models.map(
              (item) => (
                <div
                  key={
                    item.id
                  }
                  className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"
                >
                  <p className="text-sm font-medium text-zinc-200">
                    {item.id}
                  </p>

                  {item.description && (
                    <p className="mt-1 text-xs text-zinc-600">
                      {
                        item.description
                      }
                    </p>
                  )}
                </div>
              )
            )}

            {!models.length &&
              !loadingModels && (
                <p className="py-8 text-center text-sm text-zinc-600">
                  No models
                  loaded.
                </p>
              )}
          </div>
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
          <h1 className="text-2xl font-semibold">
            Settings
          </h1>

          <p className="mt-1 text-sm text-zinc-500">
            Your account.
          </p>
        </div>

        <div className="grid max-w-xl gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 sm:grid-cols-3">
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
              <p className="text-[10px] uppercase tracking-wider text-zinc-600">
                {title}
              </p>

              <p className="mt-1 text-sm text-zinc-300">
                {value}
              </p>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={handleLogout}
          className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          Sign out
        </button>
      </div>
    );
  }

  // --------------------------------------------------
  // GENERATE PAGE
  // --------------------------------------------------

  function GeneratePage() {
    const hasAspectRatio =
      model ===
        "google/nano-banana-2" ||
      Object.prototype.hasOwnProperty.call(
        schema,
        "aspect_ratio"
      );

    const hasResolution =
      model ===
        "google/nano-banana-2" ||
      Object.prototype.hasOwnProperty.call(
        schema,
        "resolution"
      );

    const outputUrls =
      getOutputUrls(
        result?.prediction
          ?.output
      );

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">
            Generate
          </h1>

          <p className="mt-1 text-sm text-zinc-500">
            Create images and
            other AI outputs.
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          {/* LEFT */}
          <div className="space-y-5">
            {/* USER + PROJECT */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
                <label className="text-xs uppercase tracking-wider text-zinc-600">
                  User
                </label>

                {/* Always the signed-in account */}
                <div className="mt-3 flex h-11 w-full items-center rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-300">
                  {user || "—"}
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
                <label className="text-xs uppercase tracking-wider text-zinc-600">
                  Project
                </label>

                <select
                  value={
                    project
                  }
                  onChange={(
                    event
                  ) =>
                    setProject(
                      event
                        .target
                        .value
                    )
                  }
                  className={`mt-3 h-11 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm outline-none focus:border-zinc-500 ${
                    project ? "" : "text-zinc-500"
                  }`}
                >
                  <option value="" disabled>
                    Select project
                  </option>

                  {projects.map(
                    (
                      item
                    ) => (
                      <option
                        key={
                          item
                        }
                        value={
                          item
                        }
                      >
                        {item}
                      </option>
                    )
                  )}
                </select>

                {!projects.length && (
                  <p className="mt-2 text-xs text-zinc-600">
                    {currentUser &&
                    canManageProjects(currentUser)
                      ? "No projects yet. Create one in Users & Projects."
                      : "No projects yet. Ask your super admin to create one."}
                  </p>
                )}
              </div>
            </div>

            {/* MODEL */}
            <div
              ref={
                modelBoxRef
              }
              className="relative rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wider text-zinc-600">
                    Model
                  </p>

                  <p className="mt-1 text-sm text-zinc-500">
                    Search and
                    select a
                    model.
                  </p>
                </div>

                {loadingModels && (
                  <span className="text-xs text-zinc-600">
                    Loading...
                  </span>
                )}
              </div>

              <div className="relative mt-4">
                <input
                  value={
                    search
                  }
                  onFocus={async () => {
                    setModelDropdownOpen(
                      true
                    );

                    if (
                      models.length ===
                      0
                    ) {
                      await loadAllModels();
                    }
                  }}
                  onClick={async () => {
                    setModelDropdownOpen(
                      true
                    );

                    if (
                      models.length ===
                      0
                    ) {
                      await loadAllModels();
                    }
                  }}
                  onChange={(
                    event
                  ) => {
                    const value =
                      event
                        .target
                        .value;

                    setSearch(
                      value
                    );

                    setModelDropdownOpen(
                      true
                    );

                    if (
                      value !==
                      model
                    ) {
                      setModel(
                        ""
                      );

                      setSchema(
                        {}
                      );

                      setInputs(
                        {}
                      );

                      setResult(
                        null
                      );
                    }
                  }}
                  placeholder="Search model..."
                  className="h-12 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 pr-12 text-sm outline-none focus:border-zinc-500"
                />

                <button
                  type="button"
                  onClick={async () => {
                    const next =
                      !modelDropdownOpen;

                    setModelDropdownOpen(
                      next
                    );

                    if (
                      next &&
                      models.length ===
                        0
                    ) {
                      await loadAllModels();
                    }
                  }}
                  className="absolute right-0 top-0 flex h-12 w-12 items-center justify-center text-zinc-600 hover:text-white"
                  aria-label="Open model list"
                >
                  {modelDropdownOpen
                    ? "⌃"
                    : "⌄"}
                </button>

                {modelDropdownOpen && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
                    {models.length ===
                      0 &&
                    !loadingModels ? (
                      <div className="px-4 py-8 text-center text-sm text-zinc-600">
                        No models
                        found.
                      </div>
                    ) : (
                      models.map(
                        (
                          item
                        ) => (
                          <button
                            key={
                              item.id
                            }
                            type="button"
                            onClick={() =>
                              selectModel(
                                item
                              )
                            }
                            className="block w-full border-b border-zinc-800 px-4 py-4 text-left last:border-0 hover:bg-zinc-900"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-zinc-200">
                                  {
                                    item.id
                                  }
                                </p>

                                {item.description && (
                                  <p className="mt-1 line-clamp-2 text-xs text-zinc-600">
                                    {
                                      item.description
                                    }
                                  </p>
                                )}
                              </div>

                              {model ===
                                item.id && (
                                <span className="shrink-0 text-[10px] text-zinc-500">
                                  Selected
                                </span>
                              )}
                            </div>
                          </button>
                        )
                      )
                    )}
                  </div>
                )}
              </div>

              {model && (
                <div className="mt-4 flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-zinc-600">
                      Selected
                    </p>

                    <p className="mt-1 truncate text-sm text-zinc-300">
                      {
                        model
                      }
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setModel(
                        ""
                      );
                      setSearch(
                        ""
                      );
                      setModels(
                        []
                      );
                      setModelDropdownOpen(
                        false
                      );
                      setSchema(
                        {}
                      );
                      setInputs(
                        {}
                      );
                      setResult(
                        null
                      );
                      setError(
                        ""
                      );
                    }}
                    className="text-xs text-zinc-600 hover:text-white"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            {/* INPUTS */}
            {model && (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
                <div className="mb-6">
                  <h2 className="font-semibold">
                    Generation
                    settings
                  </h2>

                  <p className="mt-1 text-xs text-zinc-600">
                    Configure
                    the
                    selected
                    model.
                  </p>
                </div>

                {/* PROMPT */}
                <div className="mb-6 space-y-2">
                  <label className="text-sm font-medium text-zinc-300">
                    Prompt
                  </label>

                  <StableTextArea
                    rows={6}
                    value={String(
                      inputs.prompt ??
                        ""
                    )}
                    onChange={(
                      next
                    ) =>
                      updateInput(
                        "prompt",
                        next
                      )
                    }
                    placeholder="Describe what you want to generate..."
                    className="w-full resize-y rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm leading-6 outline-none focus:border-zinc-500"
                  />

                  <p className="text-xs text-zinc-600">
                    Describe the
                    image or
                    result you
                    want to
                    generate.
                  </p>
                </div>

                {/* ASPECT RATIO + RESOLUTION */}
                {(hasAspectRatio ||
                  hasResolution) && (
                  <div className="mb-6 grid gap-4 md:grid-cols-2">
                    {hasAspectRatio && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-zinc-300">
                          Aspect
                          Ratio
                        </label>

                        <select
                          value={String(
                            inputs.aspect_ratio ??
                              "match_input_image"
                          )}
                          onChange={(
                            event
                          ) =>
                            updateInput(
                              "aspect_ratio",
                              event
                                .target
                                .value
                            )
                          }
                          className="h-11 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm outline-none focus:border-zinc-500"
                        >
                          {ASPECT_RATIOS.map(
                            (
                              ratio
                            ) => (
                              <option
                                key={
                                  ratio
                                }
                                value={
                                  ratio
                                }
                              >
                                {
                                  ratio
                                }
                              </option>
                            )
                          )}
                        </select>
                      </div>
                    )}

                    {hasResolution && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-zinc-300">
                          Resolution
                        </label>

                        <select
                          value={String(
                            inputs.resolution ??
                              "2K"
                          )}
                          onChange={(
                            event
                          ) =>
                            updateInput(
                              "resolution",
                              event
                                .target
                                .value
                            )
                          }
                          className="h-11 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm outline-none focus:border-zinc-500"
                        >
                          {schema.resolution?.enum?.map(
  (resolution) => (
    <option
      key={resolution}
      value={resolution}
    >
      {resolution}
    </option>
  )
)}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {/* SCHEMA */}
                {schemaLoading ? (
                  <div className="flex min-h-40 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950">
                    <div className="flex items-center gap-3 text-sm text-zinc-500">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-white" />

                      Loading
                      settings...
                    </div>
                  </div>
                ) : orderedFields.length ===
                  0 ? (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-6 text-center text-sm text-zinc-600">
                    No additional
                    settings
                    required.
                  </div>
                ) : (
                  <div className="space-y-6">
                    {orderedFields.map(
                      ([
                        key,
                        field,
                      ]) =>
                        renderField(
                          key,
                          field
                        )
                    )}
                  </div>
                )}

                {/* GENERATE BUTTON */}
                <button
                  type="button"
                  onClick={
                    handleGenerate
                  }
                  disabled={
                    generating ||
                    schemaLoading ||
                    !user ||
                    !project ||
                    !model
                  }
                  className="mt-7 flex h-12 w-full items-center justify-center rounded-xl bg-white text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
                >
                  {generating ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black" />

                      Generating...
                    </span>
                  ) : (
                    "Generate"
                  )}
                </button>
              </div>
            )}

            {!model && (
              <div className="flex min-h-64 items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 text-center">
                <div>
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-950 text-lg">
                    ✦
                  </div>

                  <p className="mt-4 text-sm text-zinc-500">
                    Select a
                    model to
                    continue
                  </p>
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}
          </div>

          {/* OUTPUT */}
          <div className="xl:sticky xl:top-24 xl:self-start">
            <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/70">
              <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
                <div>
                  <p className="font-semibold">
                    Output
                  </p>

                  <p className="mt-1 text-xs text-zinc-600">
                    Generated
                    result
                  </p>
                </div>

                {result && (
                  <span className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1 text-[10px] uppercase text-zinc-500">
                    {
                      result
                        .prediction
                        .status
                    }
                  </span>
                )}
              </div>

              <div className="p-4">
                {/* GENERATING */}
                {generating ||
                result?.prediction
                  .status ===
                  "starting" ||
                result?.prediction
                  .status ===
                  "processing" ||
                result?.prediction
                  .status ===
                  "queued" ? (
                  <div className="flex min-h-[520px] flex-col items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950">
                    <div className="relative mb-6 h-16 w-16">
                      <div className="absolute inset-0 rounded-full border border-zinc-800" />

                      <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-white" />
                    </div>

                    <p className="text-sm font-medium text-zinc-300">
                      Generating
                    </p>

                    <p className="mt-2 max-w-xs text-center text-xs leading-5 text-zinc-600">
                      Your output
                      is being
                      created.
                    </p>

                    <div className="mt-5 flex gap-1">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-600" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-600" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-600" />
                    </div>
                  </div>
                ) : result?.prediction
                    .status ===
                    "succeeded" &&
                  outputUrls.length >
                    0 ? (
                  <div className="space-y-4">
                    {outputUrls.map(
                      (
                        url,
                        index
                      ) => (
                        <div
                          key={`${url}-${index}`}
                          className="overflow-hidden rounded-xl border border-zinc-800 bg-black"
                        >
                          {getOutputType(url) === "video" ? (
  <video
    src={url}
    className="w-full rounded-xl"
    controls
    muted
    playsInline
  />
) : getOutputType(url) === "audio" ? (
  <audio
    src={url}
    controls
    className="w-full"
  />
) : (
  <img
    src={url}
    alt={`Generated output ${index + 1}`}
    className="max-h-[650px] w-full object-contain"
  />
)}
                        </div>
                      )
                    )}
<div className="flex flex-wrap gap-2">
  {outputUrls.map((url, index) => {
    const outputType = getOutputType(url);
    const extension =
      outputType === "video"
        ? "mp4"
        : outputType === "audio"
        ? "mp3"
        : outputType === "image"
        ? "jpg"
        : "bin";

    const label =
      outputType === "video"
        ? "Download video"
        : outputType === "audio"
        ? "Download audio"
        : outputType === "image"
        ? "Download image"
        : "Download file";

    return (
      <button
        key={`download-${index}`}
        type="button"
        onClick={() =>
          downloadImage(
            url,
            `generation-${result.prediction.id}-${index + 1}.${extension}`
          )
        }
        className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200"
      >
        {label}
        {outputUrls.length > 1
          ? ` ${index + 1}`
          : ""}
      </button>
    );
  })}
</div>
                    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                      <p className="text-xs text-zinc-600">
                        Generation
                        completed
                      </p>

                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-[10px] text-zinc-700">
                            User
                          </p>

                          <p className="mt-1 text-xs text-zinc-400">
                            {
                              result
                                .tracking
                                .user
                            }
                          </p>
                        </div>

                        <div>
                          <p className="text-[10px] text-zinc-700">
                            Project
                          </p>

                          <p className="mt-1 text-xs text-zinc-400">
                            {
                              result
                                .tracking
                                .project
                            }
                          </p>
                        </div>

                        <div>
                          <p className="text-[10px] text-zinc-700">
                            Model
                          </p>

                          <p className="mt-1 truncate text-xs text-zinc-400">
                            {
                              result
                                .tracking
                                .model
                            }
                          </p>
                        </div>

                        <div>
                          <p className="text-[10px] text-zinc-700">
                            Cost
                          </p>

                          <p className="mt-1 text-xs text-zinc-400">
                            {result.costUsd ==
                            null
                              ? "—"
                              : `$${result.costUsd.toFixed(
                                  4
                                )}`}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : result?.prediction
                    .status ===
                    "failed" ||
                  result?.prediction
                    .status ===
                    "canceled" ? (
                  <div className="flex min-h-[520px] items-center justify-center rounded-xl border border-red-950 bg-red-950/10 p-8 text-center">
                    <div>
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-red-900 text-red-400">
                        !
                      </div>

                      <p className="mt-4 text-sm font-medium text-red-300">
                        Generation
                        failed
                      </p>

                      <p className="mt-2 text-xs leading-5 text-red-500/70">
                        {
                          result
                            .prediction
                            .error
                        ||
                          "Unable to complete generation."}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-[520px] items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950 text-center">
                    <div>
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 text-zinc-600">
                        ◇
                      </div>

                      <p className="mt-4 text-sm text-zinc-500">
                        Your output
                        will appear
                        here
                      </p>

                      <p className="mt-2 max-w-xs text-xs leading-5 text-zinc-700">
                        Configure
                        your
                        generation
                        and click
                        Generate.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------
  // MENU
  // --------------------------------------------------

  const menu = [
    {
      id: "dashboard" as Page,
      label: "Dashboard",
      icon: "⌂",
    },
    {
      id: "generate" as Page,
      label: "Generate",
      icon: "✦",
    },
    {
      id: "history" as Page,
      label: "History",
      icon: "◷",
    },
    {
      id: "expenses" as Page,
      label: "Expenses",
      icon: "₹",
    },
    {
      id: "projects" as Page,
      label: "Projects",
      icon: "□",
    },
    {
      id: "models" as Page,
      label: "Models",
      icon: "◇",
    },
    ...(isManager
      ? [
          {
            id: "users" as Page,
            label:
              currentUser && canManageProjects(currentUser)
                ? "Users & Projects"
                : "Users",
            icon: "◎",
          },
        ]
      : []),
    {
      id: "settings" as Page,
      label: "Settings",
      icon: "⚙",
    },
  ];

  // --------------------------------------------------
  // PAGE CONTENT
  // --------------------------------------------------

  function renderPage() {
    switch (page) {
      case "dashboard":
        return Dashboard();

      case "generate":
        return GeneratePage();

      case "history":
        return History();

      case "expenses":
        return Expenses();

      case "projects":
        return Projects();

      case "models":
        return ModelsPage();

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

      default:
        return GeneratePage();
    }
  }

  // --------------------------------------------------
  // MAIN
  // --------------------------------------------------

  return (
    <main className="min-h-screen bg-[#09090b] text-white">
      {/* TOP BAR */}
      <header className="fixed left-0 right-0 top-0 z-40 h-16 border-b border-zinc-800 bg-[#09090b]/95 backdrop-blur">
        <div className="flex h-full items-center justify-between px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-sm font-bold text-black">
              AI
            </div>

            <div>
              <p className="text-sm font-semibold">
                AI Studio
              </p>

              <p className="hidden text-[10px] text-zinc-600 sm:block">
                Internal
                workspace
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 md:block">
              <p className="text-[9px] uppercase tracking-wider text-zinc-600">
                User
              </p>

              <p className="text-xs text-zinc-300">
                {user}
                {currentUser && (
                  <span className="ml-2 text-[10px] text-zinc-500">
                    {ROLE_LABELS[currentUser.role]}
                  </span>
                )}
              </p>
            </div>

            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold">
              {user.charAt(
                0
              )}
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-white"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* SIDEBAR */}
      <aside className="fixed bottom-0 left-0 top-16 z-30 hidden w-60 border-r border-zinc-800 bg-[#09090b] lg:block">
        <div className="flex h-full flex-col p-4">
          <nav className="mt-6 space-y-1">
            {menu.map(
              (item) => {
                const active =
                  page ===
                  item.id;

                return (
                  <button
                    key={
                      item.id
                    }
                    type="button"
                    onClick={() =>
                      setPage(
                        item.id
                      )
                    }
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition ${
                      active
                        ? "bg-zinc-900 text-white"
                        : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
                    }`}
                  >
                    <span className="flex w-5 justify-center text-sm">
                      {
                        item.icon
                      }
                    </span>

                    {
                      item.label
                    }

                    {active && (
                      <span className="ml-auto h-1.5 w-1.5 rounded-full bg-white" />
                    )}
                  </button>
                );
              }
            )}
          </nav>

          <div className="mt-auto border-t border-zinc-800 pt-4">
            <p className="text-[10px] uppercase tracking-wider text-zinc-700">
              Workspace
            </p>

            <p className="mt-2 text-xs text-zinc-500">
              AI Generation
              Portal
            </p>
          </div>
        </div>
      </aside>

      {/* MOBILE NAV */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-800 bg-[#09090b]/95 p-2 backdrop-blur lg:hidden">
        <div className="flex justify-around">
          {menu
            .slice(
              0,
              5
            )
            .map(
              (item) => (
                <button
                  key={
                    item.id
                  }
                  type="button"
                  onClick={() =>
                    setPage(
                      item.id
                    )
                  }
                  className={`flex flex-col items-center gap-1 rounded-lg px-3 py-2 text-[10px] ${
                    page ===
                    item.id
                      ? "text-white"
                      : "text-zinc-600"
                  }`}
                >
                  <span className="text-base">
                    {
                      item.icon
                    }
                  </span>

                  {
                    item.label
                  }
                </button>
              )
            )}
        </div>
      </div>

      {/* CONTENT */}
      <section className="min-h-screen pt-16 lg:pl-60">
        <div className="mx-auto max-w-[1500px] px-5 py-7 pb-24 lg:px-8 lg:pb-8">
          {renderPage()}
        </div>
      </section>
    </main>
  );
}