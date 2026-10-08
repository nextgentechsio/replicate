import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import type { ReadableStream as NodeReadableStream } from "stream/web";
import { ObjectId } from "mongodb";
import { generationOutputsBucket } from "@/lib/mongodb";

// --------------------------------------------------
// SAVED OUTPUTS (GridFS "generationOutputs")
//
// Replicate's output links expire, so each finished
// run's first output is copied into MongoDB. Unlike the
// old public/history folder, these survive deploys and
// are served only to people allowed to see the run
// (/api/generations/[id]/output).
// --------------------------------------------------

const MAX_OUTPUT_BYTES = 500 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const SERVABLE_TYPES = /^(image|video|audio)\//;

export type SavedOutput = {
  fileId: ObjectId;
  contentType: string;
  size: number;
};

export function outputUrlFor(generationId: string): string {
  return `/api/generations/${encodeURIComponent(generationId)}/output`;
}

// Copies the file at `url` into GridFS. Streams, with a
// size cap and a timeout; returns null (and leaves no
// partial file) if anything goes wrong.
export async function saveOutput(
  generationId: string,
  url: string
): Promise<SavedOutput | null> {
  let response: Response;

  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("Output download failed:", generationId, error);
    return null;
  }

  if (!response.ok || !response.body) {
    console.error("Output download failed:", generationId, response.status);
    return null;
  }

  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_OUTPUT_BYTES) {
    console.error("Output too large:", generationId, declared);
    return null;
  }

  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim();
  const contentType = SERVABLE_TYPES.test(type) ? type : "application/octet-stream";

  const bucket = await generationOutputsBucket();
  const upload = bucket.openUploadStream(generationId, {
    metadata: { generationId, contentType },
  });

  let size = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      callback(size > MAX_OUTPUT_BYTES ? new Error("Output too large") : null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>),
      limit,
      upload
    );
  } catch (error) {
    console.error("Output save failed:", generationId, error);
    await deleteOutputFile(upload.id);
    return null;
  }

  return { fileId: upload.id, contentType, size };
}

export async function deleteOutputFile(fileId: ObjectId | null | undefined) {
  if (!fileId) return;

  try {
    await (await generationOutputsBucket()).delete(fileId);
  } catch {
    // Already gone (or never fully written): nothing to do
  }
}

// Inclusive byte range for a `Range: bytes=a-b` header,
// or null when absent/unusable (send the whole file)
export function parseRange(
  header: string | null,
  size: number
): { start: number; end: number } | "invalid" | null {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;

  let start: number;
  let end: number;

  if (!match[1]) {
    // Suffix: the last N bytes
    const suffix = Number(match[2]);
    if (!suffix) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }

  if (start > end || start >= size) return "invalid";

  return { start, end };
}

export async function openOutput(
  fileId: ObjectId,
  range: { start: number; end: number } | null
): Promise<ReadableStream<Uint8Array>> {
  const stream = (await generationOutputsBucket()).openDownloadStream(
    fileId,
    // GridFS `end` is exclusive
    range ? { start: range.start, end: range.end + 1 } : undefined
  );

  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}
