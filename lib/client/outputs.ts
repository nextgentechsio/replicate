// --------------------------------------------------
// GENERATION OUTPUTS (browser only)
//
// Shared by Generate, History and Dashboard.
// --------------------------------------------------

export type OutputType = "image" | "video" | "audio" | "file";

export function getOutputUrls(output: unknown): string[] {
  if (typeof output === "string") return [output];

  if (Array.isArray(output)) {
    return output.filter(
      (item): item is string => typeof item === "string"
    );
  }

  return [];
}

// Prefer the stored content type; fall back to the URL's
// file extension (Replicate links, older saved files)
export function getOutputType(
  url: string,
  contentType?: string | null
): OutputType {
  const family = contentType?.split("/")[0];
  if (family === "video" || family === "audio" || family === "image") {
    return family;
  }

  const pathname = (() => {
    try {
      return new URL(url, "http://local").pathname.toLowerCase();
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

  if (/\.(jpg|jpeg|png|webp|gif|avif|bmp|tiff)$/i.test(pathname)) {
    return "image";
  }

  return "file";
}

const EXTENSIONS: [string, string][] = [
  ["video/mp4", ".mp4"],
  ["video/webm", ".webm"],
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/jpg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["audio/mpeg", ".mp3"],
  ["audio/wav", ".wav"],
];

// Saves an output to disk. Throws with a readable
// message; callers decide how to show it.
export async function downloadOutput(
  url: string,
  filename = "naar-output"
): Promise<void> {
  if (!url) throw new Error("Download URL is missing");

  // Saved outputs (/api/generations/..., older /history/)
  // are served by this app; Replicate links go through
  // the download proxy.
  const response = await fetch(
    url.startsWith("/") && !url.startsWith("//")
      ? url
      : `/api/download?url=${encodeURIComponent(url)}`
  );

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));

    throw new Error(
      (data as { error?: string }).error || "Download failed"
    );
  }

  const blob = await response.blob();

  if (!blob.size) throw new Error("Downloaded file is empty");

  const contentType =
    response.headers.get("content-type") || blob.type || "";

  const extension =
    EXTENSIONS.find(([type]) => contentType.includes(type))?.[1] ??
    ".bin";

  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = blobUrl;
  link.download = `${filename}${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}
