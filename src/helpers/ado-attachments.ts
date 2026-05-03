import { parse as parseHtml } from "node-html-parser";
import type { AdoClient } from "../ado-client.ts";
import type { EmbeddedImage } from "../types.ts";
import { downscaleRasterIfOversized } from "./image-downscale.ts";

export interface AdoImageGuardrails {
  maxPerUserStory: number;
  maxBytesPerImage: number;
  minBytesToKeep: number;
  downscaleLongSidePx: number;
  downscaleQuality: number;
  mimeAllowlist: string[];
  inlineSvgAsText: boolean;
}

export interface ExtractAdoImagesInput {
  /** Populated HTML field values keyed by ADO field ref (e.g. "System.Description"). */
  fieldValuesByRef: Record<string, string>;
  adoClient: AdoClient;
  userStoryId: number;
  guardrails: AdoImageGuardrails;
  /** When set, save each fetched image to `{saveRoot}/{guid}_{filename}` and populate localPath. */
  saveRoot?: string;
  /** Relative to where the draft markdown lives (used to set relativeToDraft). */
  saveRootRelativeToDraft?: string;
}

/**
 * Parse `<img>` tags in every HTML field value, resolve ADO attachment URLs,
 * fetch bytes via `AdoClient.getBinary`, apply guardrails (mime allowlist,
 * size caps with downscale for oversized rasters, SVG inline-as-text),
 * optionally save to disk. Returns one `EmbeddedImage` per image (including
 * skipped ones for audit).
 *
 * Source-order: images appear in the order their `<img>` tags appear in the
 * HTML, with fields processed in the order keys of `fieldValuesByRef` are
 * iterated. Deduplicates by ADO attachment GUID within a single call.
 *
 * Failure isolation: any single fetch / parse error marks that image as
 * `skipped: "fetch-failed"` — the function never throws.
 */
export async function extractAndFetchAdoImages(
  input: ExtractAdoImagesInput,
): Promise<EmbeddedImage[]> {
  const { fieldValuesByRef, adoClient, guardrails, saveRoot, saveRootRelativeToDraft } = input;
  const results: EmbeddedImage[] = [];
  const seenGuids = new Set<string>();

  for (const [fieldRef, html] of Object.entries(fieldValuesByRef)) {
    if (!html || typeof html !== "string") continue;
    if (!/<img\b/i.test(html)) continue; // cheap fast path

    const root = parseHtml(html);
    const imgs = root.querySelectorAll("img");

    for (const img of imgs) {
      if (results.length >= guardrails.maxPerUserStory) {
        // Hit global cap — stop fetching (we don't record skips for unseen images).
        return results;
      }

      const src = img.getAttribute("src") ?? "";
      const altAttr = img.getAttribute("alt");
      const altText = altAttr && altAttr.length > 0 ? altAttr : undefined;

      if (!src) continue;

      // Data URIs: only record as skipped if mime is unsupported — otherwise silent
      // pass-through (they're already inline in the HTML, no need to duplicate).
      if (src.startsWith("data:")) {
        const match = src.match(/^data:([^;,]+)[;,]/);
        const mimeType = match?.[1] ?? "application/octet-stream";
        if (!guardrails.mimeAllowlist.includes(mimeType)) {
          results.push({
            source: "ado",
            sourceField: fieldRef,
            originalUrl: src,
            filename: `data-uri-${results.length + 1}`,
            mimeType,
            bytes: 0,
            altText,
            skipped: "unsupported-mime",
          });
        }
        continue;
      }

      // Recognize ADO attachment URLs: dev.azure.com/{org}/{project?}/_apis/wit/attachments/{guid}
      // or legacy *.visualstudio.com/.../_apis/wit/attachments/{guid}
      const adoMatch = src.match(
        /^https:\/\/(?:dev\.azure\.com|[^/]+\.visualstudio\.com)\/[^?#]*?\/_apis\/wit\/attachments\/([a-f0-9-]{36})(?:[?#/].*)?$/i,
      );
      if (!adoMatch) {
        // External <img> — not an ADO attachment, can't fetch with our PAT.
        results.push({
          source: "ado",
          sourceField: fieldRef,
          originalUrl: src,
          filename: extractFilenameFromUrl(src) ?? "external-image",
          mimeType: "application/octet-stream",
          bytes: 0,
          altText,
          skipped: "unsupported-mime",
        });
        continue;
      }

      const guid = adoMatch[1].toLowerCase();
      if (seenGuids.has(guid)) continue; // dedupe within a single call
      seenGuids.add(guid);

      const filename = extractFilenameFromUrl(src) ?? `${guid}.bin`;

      // Fetch the attachment bytes via AdoClient. The src is an absolute URL —
      // strip down to the pathname + preserved query params (minus api-version,
      // which getBinary re-applies).
      let fetchedBuffer: ArrayBuffer;
      let fetchedMime: string | null;
      try {
        const url = new URL(src);
        // AdoClient.buildUrl prepends baseUrl, so strip anything before `/_apis/`.
        // The src URL's project segment may be the project GUID (ADO's canonical
        // attachment form) while baseUrl uses the project name — string prefix
        // match would fail and produce a double-project URL. Extracting from
        // `/_apis/` onwards works for both `dev.azure.com/{org}/{project}/_apis/...`
        // and `dev.azure.com/{org}/_apis/...` (org-level attachment URLs).
        const apisIdx = url.pathname.indexOf("/_apis/");
        const path = apisIdx >= 0 ? url.pathname.slice(apisIdx) : url.pathname;

        const queryParams: Record<string, string> = {};
        url.searchParams.forEach((v, k) => {
          if (k.toLowerCase() !== "api-version") queryParams[k] = v;
        });
        queryParams.download = "true";

        const binary = await adoClient.getBinary(path, "7.0", queryParams);
        fetchedBuffer = binary.buffer;
        fetchedMime = binary.mimeType;
      } catch {
        results.push({
          source: "ado",
          sourceField: fieldRef,
          originalUrl: src,
          filename,
          mimeType: "application/octet-stream",
          bytes: 0,
          altText,
          skipped: "fetch-failed",
        });
        continue;
      }

      const rawBytes = fetchedBuffer.byteLength;
      // ADO attachment endpoints respond with application/octet-stream — derive
      // true MIME from filename extension; fall back to response header if header
      // looks legitimate (starts with "image/" or "text/").
      const extMime = mimeFromFilename(filename);
      const headerMime =
        fetchedMime && (fetchedMime.startsWith("image/") || fetchedMime.startsWith("text/"))
          ? fetchedMime
          : null;
      const mimeType = extMime ?? headerMime ?? "application/octet-stream";

      // Mime allowlist
      if (!guardrails.mimeAllowlist.includes(mimeType)) {
        results.push({
          source: "ado",
          sourceField: fieldRef,
          originalUrl: src,
          filename,
          mimeType,
          bytes: rawBytes,
          altText,
          skipped: "unsupported-mime",
        });
        continue;
      }

      // Min-size filter (drops icons/spacers)
      if (rawBytes < guardrails.minBytesToKeep) {
        results.push({
          source: "ado",
          sourceField: fieldRef,
          originalUrl: src,
          filename,
          mimeType,
          bytes: rawBytes,
          altText,
          skipped: "too-small",
        });
        continue;
      }

      // Downscale raster if oversized
      let finalBuffer: ArrayBuffer = fetchedBuffer;
      let downscaled = false;
      let originalBytes: number | undefined;
      try {
        const dr = await downscaleRasterIfOversized(fetchedBuffer, mimeType, {
          maxBytesPerImage: guardrails.maxBytesPerImage,
          downscaleLongSidePx: guardrails.downscaleLongSidePx,
          downscaleQuality: guardrails.downscaleQuality,
        });
        finalBuffer = dr.buffer;
        if (dr.downscaled) {
          downscaled = true;
          originalBytes = dr.originalBytes;
        }
      } catch {
        // jimp couldn't decode — record as fetch-failed (bytes present but unprocessable).
        results.push({
          source: "ado",
          sourceField: fieldRef,
          originalUrl: src,
          filename,
          mimeType,
          bytes: rawBytes,
          altText,
          skipped: "fetch-failed",
        });
        continue;
      }

      const finalBytes = finalBuffer.byteLength;

      // If STILL too large after downscale attempt, skip.
      if (finalBytes > guardrails.maxBytesPerImage && mimeType !== "image/svg+xml") {
        results.push({
          source: "ado",
          sourceField: fieldRef,
          originalUrl: src,
          filename,
          mimeType,
          bytes: finalBytes,
          altText,
          skipped: "too-large",
          ...(originalBytes !== undefined ? { originalBytes } : {}),
          ...(downscaled ? { downscaled: true } : {}),
        });
        continue;
      }

      // SVG inline text
      let svgInlineText: string | undefined;
      if (mimeType === "image/svg+xml" && guardrails.inlineSvgAsText) {
        try {
          svgInlineText = Buffer.from(finalBuffer).toString("utf-8");
        } catch {
          // Non-fatal; just skip the inline text.
        }
      }

      const entry: EmbeddedImage = {
        source: "ado",
        sourceField: fieldRef,
        originalUrl: src,
        filename,
        mimeType,
        bytes: finalBytes,
        altText,
        ...(downscaled ? { downscaled: true, originalBytes } : {}),
        ...(svgInlineText ? { svgInlineText } : {}),
      };

      // Optional local save
      if (saveRoot) {
        try {
          const { writeFileSync, mkdirSync, existsSync } = await import("fs");
          const { join } = await import("path");
          if (!existsSync(saveRoot)) mkdirSync(saveRoot, { recursive: true });
          const safeName = sanitizeFilename(filename);
          const diskFilename = `${guid}_${safeName}`;
          const diskPath = join(saveRoot, diskFilename);
          writeFileSync(diskPath, Buffer.from(finalBuffer));
          entry.localPath = diskPath;
          if (saveRootRelativeToDraft) {
            entry.relativeToDraft = `${saveRootRelativeToDraft}/${diskFilename}`.replace(/\/+/g, "/");
          }
        } catch {
          // Disk write failed — MCP parts still flow; absence of localPath signals the miss.
        }
      }

      results.push(entry);
    }
  }

  return results;
}

function extractFilenameFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const fn = u.searchParams.get("fileName");
    if (fn) return fn;
    const last = u.pathname.split("/").pop();
    if (last && last.includes(".")) return last;
    return null;
  } catch {
    return null;
  }
}

function mimeFromFilename(filename: string): string | null {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = lower.slice(dot + 1);
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "tif":
    case "tiff":
      return "image/tiff";
    default:
      return null;
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "image";
}
