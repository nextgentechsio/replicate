import fs from "fs/promises";
import path from "path";
import { recordExpense } from "@/lib/expenses";
import type { Filter } from "mongodb";
import {
  generationsCollection,
  type GenerationDoc,
} from "@/lib/mongodb";
import { calculateReplicateCost } from "@/lib/replicate-cost";
import { canManageUsers } from "@/lib/roles";
import type { StoredUser } from "@/lib/users";

// --------------------------------------------------
// GENERATION HISTORY (MongoDB "generations")
//
// Written by the server only: a record is created when
// /api/generate starts a prediction, and updated with
// status, cost and output whenever we hear back from
// Replicate (client polling or reconcilePending).
// --------------------------------------------------

const TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "canceled",
]);

export function isTerminalStatus(status: unknown) {
  return (
    typeof status === "string" &&
    TERMINAL_STATUSES.has(status)
  );
}

export type PublicGeneration = {
  id: string;
  predictionId: string;
  userId: string;
  user: string;
  projectId: string;
  project: string;
  model: string;
  prompt: string;
  inputImage: string | null;
  aspectRatio: string;
  resolution: string;
  status: string;
  error: string | null;
  costUsd: number | null;
  // Saved copy when available (Replicate URLs expire)
  outputUrl: string | null;
  replicateOutputUrl: string | null;
  predictTime: number | null;
  createdAt: string;
  completedAt: string | null;
};

function toPublicGeneration(
  doc: GenerationDoc
): PublicGeneration {
  return {
    id: doc._id,
    predictionId: doc._id,
    userId: doc.userId,
    user: doc.userName,
    projectId: doc.projectId,
    project: doc.projectName,
    model: doc.model,
    prompt: doc.prompt,
    inputImage: doc.inputImage,
    aspectRatio: doc.aspectRatio,
    resolution: doc.resolution,
    status: doc.status,
    error: doc.error,
    costUsd: doc.costUsd,
    outputUrl: doc.localOutputUrl ?? doc.outputUrl,
    replicateOutputUrl: doc.outputUrl,
    predictTime: doc.predictTime,
    createdAt: doc.createdAt.toISOString(),
    completedAt: doc.completedAt?.toISOString() ?? null,
  };
}

export function canViewGeneration(
  actor: StoredUser,
  generation: Pick<GenerationDoc, "userId">
): boolean {
  return (
    generation.userId === actor.id ||
    canManageUsers(actor)
  );
}

function firstUrl(value: unknown): string | null {
  const candidates = Array.isArray(value) ? value : [value];

  const url = candidates.find(
    (item): item is string =>
      typeof item === "string" &&
      /^https?:\/\//i.test(item)
  );

  return url ?? null;
}

// Keep stored inputs small (they are URLs and settings,
// but never trust that blindly).
const MAX_INPUTS_BYTES = 50_000;

function storableInputs(
  inputs: Record<string, unknown>
): Record<string, unknown> {
  return JSON.stringify(inputs).length <= MAX_INPUTS_BYTES
    ? inputs
    : { truncated: true };
}

// --------------------------------------------------
// CREATE
// --------------------------------------------------

export async function recordGeneration(input: {
  predictionId: string;
  user: StoredUser;
  project: { id: string; name: string };
  model: string;
  version: string;
  inputs: Record<string, unknown>;
  status: string;
  createdAt?: string;
}) {
  const now = new Date();

  const createdAt = input.createdAt
    ? new Date(input.createdAt)
    : now;

  const doc: GenerationDoc = {
    _id: input.predictionId,
    userId: input.user.id,
    userName: input.user.name,
    projectId: input.project.id,
    projectName: input.project.name,
    provider: "replicate",
    model: input.model,
    version: input.version,
    prompt: String(input.inputs.prompt ?? ""),
    inputs: storableInputs(input.inputs),
    inputImage: firstUrl(input.inputs.image_input),
    aspectRatio: String(input.inputs.aspect_ratio ?? ""),
    resolution: String(input.inputs.resolution ?? ""),
    status: input.status || "starting",
    error: null,
    costUsd: null,
    outputUrl: null,
    localOutputUrl: null,
    predictTime: null,
    createdAt: Number.isNaN(createdAt.getTime())
      ? now
      : createdAt,
    updatedAt: now,
    completedAt: null,
  };

  await (await generationsCollection()).insertOne(doc);
}

// --------------------------------------------------
// READ
// --------------------------------------------------

export async function getGeneration(
  id: string
): Promise<GenerationDoc | null> {
  return (await generationsCollection()).findOne({
    _id: id,
  });
}

export const HISTORY_STATUSES = [
  "succeeded",
  "failed",
  "running",
] as const;

export type HistoryStatus = (typeof HISTORY_STATUSES)[number];

export type HistoryQuery = {
  page?: number;
  pageSize?: number;
  projectId?: string;
  userId?: string;
  model?: string;
  status?: HistoryStatus;
  // Case-insensitive match on the prompt
  q?: string;
};

export type HistoryPage = {
  generations: PublicGeneration[];
  total: number;
  page: number;
  pageSize: number;
  // Values that exist in what the viewer may see, for
  // the filter dropdowns
  options: {
    projects: { id: string; name: string }[];
    users: { id: string; name: string }[];
    models: string[];
  };
};

export const HISTORY_MAX_PAGE_SIZE = 60;

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const STATUS_FILTERS: Record<HistoryStatus, Filter<GenerationDoc>> = {
  succeeded: { status: "succeeded" },
  failed: { status: { $in: ["failed", "canceled"] } },
  running: { status: { $nin: ["succeeded", "failed", "canceled"] } },
};

export async function listGenerations(
  actor: StoredUser,
  query: HistoryQuery = {}
): Promise<HistoryPage> {
  const pageSize = Math.min(
    Math.max(1, Math.floor(query.pageSize ?? 24)),
    HISTORY_MAX_PAGE_SIZE
  );
  const page = Math.max(1, Math.floor(query.page ?? 1));

  // Plain users see only their own generations, so a
  // user filter only applies to managers
  const scope: Filter<GenerationDoc> = canManageUsers(actor)
    ? {}
    : { userId: actor.id };

  const filter: Filter<GenerationDoc> = { ...scope };

  if (query.projectId) filter.projectId = query.projectId;
  if (query.userId && canManageUsers(actor)) filter.userId = query.userId;
  if (query.model) filter.model = query.model;
  if (query.status) Object.assign(filter, STATUS_FILTERS[query.status]);

  const q = query.q?.trim().slice(0, 100);
  if (q) filter.prompt = { $regex: escapeRegex(q), $options: "i" };

  const collection = await generationsCollection();

  const [docs, total, projects, users, models] = await Promise.all([
    collection
      .find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
    collection.countDocuments(filter),
    collection
      .aggregate<{ _id: string; name: string }>([
        // Newest first, so a renamed project shows its
        // current name
        { $match: scope },
        { $sort: { createdAt: -1 } },
        { $group: { _id: "$projectId", name: { $first: "$projectName" } } },
        { $sort: { name: 1 } },
      ])
      .toArray(),
    canManageUsers(actor)
      ? collection
          .aggregate<{ _id: string; name: string }>([
            { $sort: { createdAt: -1 } },
            { $group: { _id: "$userId", name: { $first: "$userName" } } },
            { $sort: { name: 1 } },
          ])
          .toArray()
      : Promise.resolve([]),
    collection.distinct("model", scope),
  ]);

  return {
    generations: docs.map(toPublicGeneration),
    total,
    page,
    pageSize,
    options: {
      projects: projects.map((item) => ({ id: item._id, name: item.name })),
      users: users.map((item) => ({ id: item._id, name: item.name })),
      models: (models as string[]).sort(),
    },
  };
}

// One generation with the inputs it ran with, for
// "Run again". Null when missing or not the viewer's.
export async function getGenerationForViewer(
  actor: StoredUser,
  id: string
): Promise<(PublicGeneration & { inputs: Record<string, unknown> }) | null> {
  const doc = await getGeneration(id);

  if (!doc || !canViewGeneration(actor, doc)) return null;

  return { ...toPublicGeneration(doc), inputs: doc.inputs ?? {} };
}

// --------------------------------------------------
// REPLICATE SYNC
// --------------------------------------------------

export async function fetchPrediction(
  id: string
): Promise<
  | { ok: true; prediction: Record<string, unknown> }
  | { ok: false; status: number; error: string }
> {
  const token = process.env.REPLICATE_API_TOKEN;

  if (!token) {
    return {
      ok: false,
      status: 500,
      error: "REPLICATE_API_TOKEN is missing in .env.local",
    };
  }

  const response = await fetch(
    `https://api.replicate.com/v1/predictions/${encodeURIComponent(id)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error:
        data?.detail ||
        data?.error ||
        "Failed to fetch prediction",
    };
  }

  return { ok: true, prediction: data };
}

async function saveReplicateOutput(
  output: unknown,
  predictionId: string
): Promise<string | null> {
  const outputUrl = firstUrl(output);

  if (!outputUrl) return null;

  try {
    const response = await fetch(outputUrl);

    if (!response.ok) {
      console.error(
        "Failed to download Replicate output:",
        response.status
      );
      return null;
    }

    const contentType =
      response.headers.get("content-type") || "";

    let extension = ".bin";

    if (contentType.includes("image/png")) {
      extension = ".png";
    } else if (contentType.includes("image/jpeg")) {
      extension = ".jpg";
    } else if (contentType.includes("image/webp")) {
      extension = ".webp";
    } else if (contentType.includes("video/mp4")) {
      extension = ".mp4";
    } else if (contentType.includes("video/webm")) {
      extension = ".webm";
    }

    const historyDir = path.join(
      process.cwd(),
      "public",
      "history"
    );

    await fs.mkdir(historyDir, { recursive: true });

    const fileName = `${predictionId}${extension}`;
    const filePath = path.join(historyDir, fileName);

    // Don't download the same output again
    try {
      await fs.access(filePath);
      return `/history/${fileName}`;
    } catch {
      // File doesn't exist, continue
    }

    const buffer = Buffer.from(
      await response.arrayBuffer()
    );

    await fs.writeFile(filePath, buffer);

    console.log("REPLICATE OUTPUT SAVED:", filePath);

    return `/history/${fileName}`;
  } catch (error) {
    console.error(
      "Failed to save Replicate output:",
      error
    );

    return null;
  }
}

// Store what Replicate told us about a prediction.
// Cost is computed from the model stored at creation,
// never from anything the client sends.
export async function applyPrediction(
  generation: GenerationDoc,
  prediction: Record<string, unknown>
): Promise<{
  costUsd: number | null;
  localOutputUrl: string | null;
}> {
  const status = String(prediction.status ?? "");
  const terminal = isTerminalStatus(status);

  // Already final: nothing new to record
  if (isTerminalStatus(generation.status)) {
    return {
      costUsd: generation.costUsd,
      localOutputUrl: generation.localOutputUrl,
    };
  }

  const set: Partial<GenerationDoc> = {
    status,
    updatedAt: new Date(),
  };

  let costUsd: number | null = null;
  let localOutputUrl: string | null = null;

  if (terminal) {
    try {
      // Price from Replicate's echoed input; fall back
      // to the inputs we stored if it's missing, so
      // resolution/duration tiers aren't lost.
      costUsd = calculateReplicateCost(generation.model, {
        ...prediction,
        input:
          (prediction.input as Record<string, unknown>) ??
          generation.inputs,
      });
    } catch (costError) {
      console.error("Cost calculation error:", costError);
    }

    if (status === "succeeded" && prediction.output) {
      localOutputUrl = await saveReplicateOutput(
        prediction.output,
        generation._id
      );
    }

    const metrics = prediction.metrics as
      | { predict_time?: number }
      | undefined;

    set.costUsd = costUsd;
    set.outputUrl = firstUrl(prediction.output);
    set.localOutputUrl = localOutputUrl;
    set.error =
      typeof prediction.error === "string"
        ? prediction.error
        : null;
    set.predictTime =
      typeof metrics?.predict_time === "number"
        ? metrics.predict_time
        : null;
    set.completedAt = new Date();
  }

  await (await generationsCollection()).updateOne(
    { _id: generation._id },
    { $set: set }
  );

  // Bill succeeded generations in the expense ledger
  // (insert-only, so repeated polls can't double-count)
  if (status === "succeeded") {
    await recordExpense(
      generation,
      costUsd,
      set.completedAt ?? new Date()
    );
  }

  return { costUsd, localOutputUrl };
}

// Finish records whose browser tab closed before the
// prediction completed. Bounded so a page load stays fast.
export async function reconcilePending(
  actor: StoredUser,
  limit = 10
) {
  const olderThan = new Date(Date.now() - 15_000);

  const pending = await (await generationsCollection())
    .find({
      status: { $nin: [...TERMINAL_STATUSES] },
      createdAt: { $lt: olderThan },
      ...(canManageUsers(actor) ? {} : { userId: actor.id }),
    })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  await Promise.allSettled(
    pending.map(async (generation) => {
      const result = await fetchPrediction(generation._id);

      if (result.ok) {
        await applyPrediction(generation, result.prediction);
      }
    })
  );
}
