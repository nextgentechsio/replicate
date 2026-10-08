"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  buildGenerationInputs,
  schemaDefaults,
  type Schema,
} from "@/app/(studio)/generate/fields";
import { errorMessage, fetchJson } from "@/lib/client/http";
import type { ModelKind } from "@/lib/model-catalog";
import { useStudio } from "./StudioProvider";

// --------------------------------------------------
// GENERATE STATE
//
// Mounted in the studio layout, not the Generate page,
// so a half-filled form and a running generation keep
// going while the user looks at History or Expenses.
// The server also finishes runs on its own (see
// reconcilePending), so closing the tab loses nothing.
// --------------------------------------------------

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_CONSECUTIVE_POLL_ERRORS = 10;
const MAX_IMAGE_BYTES = 26 * 1024 * 1024;

export type SearchModel = {
  id: string;
  owner: string;
  name: string;
  description?: string | null;
  coverImageUrl?: string | null;
  runCount?: number;
};

export type Prediction = {
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
};

export type GenerationResult = {
  prediction: Prediction;
  costUsd: number | null;
};

function validCost(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

// The server prices runs from our table; older payload
// shapes are still accepted.
function predictionCost(
  prediction: (Prediction & { cost?: unknown }) | undefined,
  fallback?: unknown
): number | null {
  return (
    validCost(prediction?.costUsd) ??
    validCost(prediction?.cost) ??
    validCost(prediction?.metrics?.cost) ??
    validCost(fallback)
  );
}

type GenerateContextValue = {
  // Project (by name; blank until the user picks one)
  project: string;
  setProject: (name: string) => void;

  // Model
  model: string;
  // fromSearch keeps the id in the search box, so the
  // search doesn't re-run for the previous query
  chooseModel: (id: string, fromSearch?: boolean) => void;
  catalogFilter: ModelKind | "all";
  setCatalogFilter: (filter: ModelKind | "all") => void;
  showOtherModels: boolean;
  toggleOtherModels: () => void;
  search: string;
  setSearch: (query: string) => void;
  searchResults: SearchModel[];
  searching: boolean;

  // Inputs
  schema: Schema;
  schemaLoading: boolean;
  inputs: Record<string, unknown>;
  updateInput: (key: string, value: unknown) => void;
  filePreviews: Record<string, string[]>;
  removeImage: (key: string, index: number) => void;
  uploading: Record<string, number>;
  uploadFile: (key: string, file: File) => void;

  // Run
  generating: boolean;
  result: GenerationResult | null;
  error: string;
  setError: (message: string) => void;
  generate: () => void;
};

const GenerateContext = createContext<GenerateContextValue | null>(null);

export function GenerateProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { projects } = useStudio();

  const [selectedProject, setProject] = useState("");

  // Starts blank so the user must pick a project. Also
  // resets to blank if the chosen project is archived or
  // renamed meanwhile.
  const project = projects.some((item) => item.name === selectedProject)
    ? selectedProject
    : "";

  const [model, setModel] = useState("");
  const [catalogFilter, setCatalogFilter] = useState<ModelKind | "all">(
    "all"
  );
  const [showOtherModels, setShowOtherModels] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchModel[]>([]);
  const [searching, setSearching] = useState(false);

  const [schema, setSchema] = useState<Schema>({});
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [inputs, setInputs] = useState<Record<string, unknown>>({});
  const [filePreviews, setFilePreviews] = useState<
    Record<string, string[]>
  >({});
  const [uploading, setUploading] = useState<Record<string, number>>({});

  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [error, setError] = useState("");

  // Ignore schema responses for a model that is no
  // longer selected (fast clicking between models)
  const latestModelRef = useRef("");

  // --------------------------------------------------
  // MODEL SEARCH ("Use another Replicate model")
  // --------------------------------------------------

  useEffect(() => {
    const query = search.trim();

    if (!query || query === model) return;

    // State is only set inside the timer callback
    const timer = setTimeout(async () => {
      setSearching(true);
      setError("");

      try {
        const data = await fetchJson<{ models?: SearchModel[] }>(
          `/api/models/search?q=${encodeURIComponent(query)}`
        );

        setSearchResults(Array.isArray(data.models) ? data.models : []);
      } catch (err) {
        console.error(err);
        setSearchResults([]);
        setError("Unable to search models.");
      } finally {
        setSearching(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [search, model]);

  // --------------------------------------------------
  // SELECT MODEL + LOAD ITS SCHEMA
  // --------------------------------------------------

  const clearPreviews = useCallback(() => {
    setFilePreviews((previous) => {
      Object.values(previous)
        .flat()
        .forEach((url) => URL.revokeObjectURL(url));

      return {};
    });
  }, []);

  const chooseModel = useCallback(
    (id: string, fromSearch = false) => {
      latestModelRef.current = id;

      setModel(id);
      setSearch(fromSearch ? id : "");
      setSearchResults([]);
      setResult(null);
      setError("");
      clearPreviews();

      if (!id) {
        setSchema({});
        setInputs({});
        setSchemaLoading(false);
        return;
      }

      setSchemaLoading(true);

      fetchJson<{ inputSchema?: Schema }>(
        `/api/models/schema?model=${encodeURIComponent(id)}`
      )
        .then((data) => {
          if (latestModelRef.current !== id) return;

          const modelSchema = data.inputSchema ?? {};

          setSchema(modelSchema);
          setInputs(schemaDefaults(id, modelSchema));
        })
        .catch((err) => {
          if (latestModelRef.current !== id) return;

          console.error(err);
          setSchema({});
          setInputs({});
          setError("Unable to load model settings.");
        })
        .finally(() => {
          if (latestModelRef.current === id) setSchemaLoading(false);
        });
    },
    [clearPreviews]
  );

  // --------------------------------------------------
  // INPUTS + UPLOADS
  // --------------------------------------------------

  const updateInput = useCallback((key: string, value: unknown) => {
    setInputs((previous) => ({ ...previous, [key]: value }));
  }, []);

  const removeImage = useCallback((key: string, index: number) => {
    setInputs((previous) => {
      const value = previous[key];
      const images = Array.isArray(value) ? value : value ? [value] : [];

      return {
        ...previous,
        [key]: images.filter((_, i) => i !== index),
      };
    });

    // Keep previews aligned with inputs
    setFilePreviews((previous) => {
      const removed = previous[key]?.[index];
      if (removed) URL.revokeObjectURL(removed);

      return {
        ...previous,
        [key]: (previous[key] ?? []).filter((_, i) => i !== index),
      };
    });
  }, []);

  const uploadFile = useCallback(
    async (key: string, file: File) => {
      const isMedia =
        file.type.startsWith("video/") || file.type.startsWith("audio/");

      if (!isMedia && file.size > MAX_IMAGE_BYTES) {
        setError("Please use an image smaller than 26 MB.");
        return;
      }

      // Per-field upload counter drives the "Uploading…" state
      setUploading((previous) => ({
        ...previous,
        [key]: (previous[key] ?? 0) + 1,
      }));
      setError("");

      try {
        const body = new FormData();
        body.append("file", file, file.name);

        const data = await fetchJson<{ url?: string }>("/api/upload", {
          method: "POST",
          body,
        });

        if (!data.url) {
          throw new Error("Upload did not return a file URL.");
        }

        const url = data.url;

        // VIDEO / AUDIO: single file per field
        if (isMedia) {
          updateInput(key, url);
          return;
        }

        // IMAGE: appended, with a local preview
        setFilePreviews((previous) => ({
          ...previous,
          [key]: [...(previous[key] ?? []), URL.createObjectURL(file)],
        }));

        setInputs((previous) => {
          const current = previous[key];
          const images = Array.isArray(current)
            ? current
            : current
              ? [current]
              : [];

          return { ...previous, [key]: [...images, url] };
        });
      } catch (err) {
        console.error(err);
        setError(errorMessage(err, "Unable to upload the file."));
      } finally {
        setUploading((previous) => ({
          ...previous,
          [key]: Math.max(0, (previous[key] ?? 1) - 1),
        }));
      }
    },
    [updateInput]
  );

  // --------------------------------------------------
  // POLLING
  // --------------------------------------------------

  const pollPrediction = useCallback((predictionId: string) => {
    // Stop eventually so a stuck or missing prediction
    // doesn't hit the API every 2s forever.
    const startedAt = Date.now();
    let consecutiveErrors = 0;

    function scheduleNext() {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        setError(
          "Stopped checking: generation took longer than 15 minutes. Check History for the final result."
        );
        return;
      }

      setTimeout(poll, POLL_INTERVAL_MS);
    }

    function handlePollError() {
      consecutiveErrors++;

      if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
        setError(
          "Stopped checking: the prediction status could not be fetched."
        );
        return;
      }

      scheduleNext();
    }

    async function poll() {
      try {
        const data = await fetchJson<{
          prediction?: Prediction;
          costUsd?: number | null;
        }>(`/api/predictions/${encodeURIComponent(predictionId)}`);

        const prediction = data.prediction;

        if (!prediction) {
          handlePollError();
          return;
        }

        consecutiveErrors = 0;

        setResult((previous) =>
          // Ignore if the user started over meanwhile
          previous?.prediction.id === predictionId
            ? {
                prediction,
                costUsd:
                  predictionCost(prediction, data.costUsd) ??
                  previous.costUsd,
              }
            : previous
        );

        if (
          prediction.status === "succeeded" ||
          prediction.status === "failed" ||
          prediction.status === "canceled"
        ) {
          return;
        }

        scheduleNext();
      } catch (err) {
        console.error("Prediction polling error:", err);
        handlePollError();
      }
    }

    setTimeout(poll, 1500);
  }, []);

  // --------------------------------------------------
  // GENERATE
  // --------------------------------------------------

  const generate = useCallback(async () => {
    setError("");
    setResult(null);

    if (!project) {
      setError("Please select a project.");
      return;
    }

    if (!model) {
      setError("Please select a model.");
      return;
    }

    setGenerating(true);

    try {
      const data = await fetchJson<{
        prediction?: Prediction;
        costUsd?: number | null;
        tracking?: { predictionId?: string };
      }>("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project,
          model,
          inputs: buildGenerationInputs(inputs),
        }),
      });

      const predictionId =
        data.tracking?.predictionId || data.prediction?.id || "";

      if (!data.prediction || !predictionId) {
        throw new Error("Replicate did not return a prediction.");
      }

      setResult({
        prediction: { ...data.prediction, id: predictionId },
        costUsd: predictionCost(data.prediction, data.costUsd),
      });

      pollPrediction(predictionId);
    } catch (err) {
      console.error(err);
      setError(errorMessage(err, "Generation failed."));
    } finally {
      setGenerating(false);
    }
  }, [project, model, inputs, pollPrediction]);

  const value: GenerateContextValue = {
    project,
    setProject,
    model,
    chooseModel,
    catalogFilter,
    setCatalogFilter,
    showOtherModels,
    toggleOtherModels: () => setShowOtherModels((open) => !open),
    search,
    setSearch,
    searchResults,
    searching,
    schema,
    schemaLoading,
    inputs,
    updateInput,
    filePreviews,
    removeImage,
    uploading,
    uploadFile,
    generating,
    result,
    error,
    setError,
    generate,
  };

  return (
    <GenerateContext.Provider value={value}>
      {children}
    </GenerateContext.Provider>
  );
}

export function useGenerate(): GenerateContextValue {
  const value = useContext(GenerateContext);

  if (!value) {
    throw new Error("useGenerate must be used inside <GenerateProvider>");
  }

  return value;
}
