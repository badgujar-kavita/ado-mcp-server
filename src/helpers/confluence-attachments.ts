import { parse as parseHtml } from "node-html-parser";
import type { ConfluenceClient } from "../confluence-client.ts";
import type { EmbeddedImage } from "../types.ts";
import { downscaleRasterIfOversized } from "./image-downscale.ts";

export interface ConfluenceImageGuardrails {
  maxBytesPerImage: number;
  minBytesToKeep: number;
  downscaleLongSidePx: number;
  downscaleQuality: number;
  mimeAllowlist: string[];
  inlineSvgAsText: boolean;
}

export interface FetchCurrentVersionAttachmentsInput {
  pageId: string;
  storageHtml: string;
  confluenceClient: ConfluenceClient;
  guardrails: ConfluenceImageGuardrails;
  /** When set, save each fetched image to `{saveRoot}/{pageId}/{filename}`. */
  saveRoot?: string;
  /** Relative path from draft markdown to saveRoot (used to set relativeToDraft). */
  saveRootRelativeToDraft?: string;
}

/**
 * Parse `<ac:image>` and `<img>` tags in Confluence storage HTML, join against
 * the page's current attachment list by filename, fetch the bytes, apply
 * guardrails, optionally save to disk. Returns `EmbeddedImage[]` in source-
 * document order.
 *
 * Handled storage-HTML variants:
 *   <ac:image><ri:attachment ri:filename="diagram.png"/></ac:image>       -> same-page attachment (fetched)
 *   <ac:image><ri:attachment …><ri:page ri:content-title="x"/></ac:image> -> cross-page (skipped here; caller tracks)
 *   <ac:image><ri:url ri:value="https://…"/></ac:image>                   -> external (skipped here; caller tracks)
 *   <img src="/wiki/download/attachments/…">                              -> direct href (fetched)
 *
 * Dedupe by filename within the page. Failure isolation: any single fetch
 * error marks the image `skipped: "fetch-failed"`; function never throws.
 */
export async function fetchCurrentVersionAttachments(
  input: FetchCurrentVersionAttachmentsInput,
): Promise<EmbeddedImage[]> {
  const {
    pageId,
    storageHtml,
    confluenceClient,
    guardrails,
    saveRoot,
    saveRootRelativeToDraft,
  } = input;

  if (!storageHtml || typeof storageHtml !== "string") return [];

  // 1. List current attachments on the page (filename -> attachment record).
  let attachmentList;
  try {
    attachmentList = await confluenceClient.listAttachments(pageId);
  } catch {
    return []; // Failure to list = no attachments available this run.
  }

  // Index by filename, keeping the highest version.number if duplicates appear.
  const byFilename = new Map<string, (typeof attachmentList)[number]>();
  for (const item of attachmentList) {
    const existing = byFilename.get(item.title);
    if (!existing || item.version.number > existing.version.number) {
      byFilename.set(item.title, item);
    }
  }

  // 2. Parse storage HTML for image references (in document order).
  const root = parseHtml(storageHtml);
  type Ref = { filename: string; altText?: string };
  const refs: Ref[] = [];

  // <ac:image> with <ri:attachment ri:filename="..."/>
  const acImages = root.querySelectorAll("ac\\:image");
  for (const acImage of acImages) {
    const attachment = acImage.querySelector("ri\\:attachment");
    const page = acImage.querySelector("ri\\:page");
    const url = acImage.querySelector("ri\\:url");
    const alt = acImage.getAttribute("ac:alt") ?? undefined;

    if (url) continue; // external URL — caller tracks as unfetched
    if (page) continue; // cross-page — caller tracks as unfetched
    if (attachment) {
      const filename = attachment.getAttribute("ri:filename");
      if (filename) refs.push({ filename, altText: alt });
    }
  }

  // Plain <img src="..."> — resolve download URLs of the form /download/attachments/{pageId}/{filename}
  const plainImgs = root.querySelectorAll("img");
  for (const img of plainImgs) {
    const src = img.getAttribute("src");
    if (!src) continue;
    const alt = img.getAttribute("alt") ?? undefined;
    const dlMatch = src.match(/\/download\/attachments\/[^/]+\/([^?/]+)/);
    if (dlMatch) {
      let filename: string;
      try {
        filename = decodeURIComponent(dlMatch[1]);
      } catch {
        filename = dlMatch[1];
      }
      refs.push({ filename, altText: alt });
    }
  }

  // 3. Dedupe by filename preserving first-seen order.
  const seen = new Set<string>();
  const deduped: Ref[] = [];
  for (const r of refs) {
    if (seen.has(r.filename)) continue;
    seen.add(r.filename);
    deduped.push(r);
  }

  // 4. Fetch each matched attachment.
  const results: EmbeddedImage[] = [];
  const baseUrl = confluenceClient.baseUrl;

  for (const ref of deduped) {
    const meta = byFilename.get(ref.filename);
    if (!meta) continue; // Referenced filename isn't an attachment on this page (moved/deleted).

    const originalUrl = meta.downloadUrl.startsWith("http")
      ? meta.downloadUrl
      : `${baseUrl}${meta.downloadUrl.startsWith("/") ? "" : "/"}${meta.downloadUrl}`;

    let bytes: ArrayBuffer;
    let fetchedMime: string | null;
    try {
      const fetched = await confluenceClient.fetchAttachmentBinary(meta.downloadUrl);
      bytes = fetched.buffer;
      fetchedMime = fetched.mimeType;
    } catch {
      results.push({
        source: "confluence",
        sourcePageId: pageId,
        originalUrl,
        filename: ref.filename,
        mimeType: meta.mediaType,
        bytes: 0,
        altText: ref.altText,
        skipped: "fetch-failed",
      });
      continue;
    }

    const rawBytes = bytes.byteLength;
    const effectiveMime =
      fetchedMime && fetchedMime !== "application/octet-stream"
        ? fetchedMime
        : meta.mediaType || "application/octet-stream";

    // Mime allowlist
    if (!guardrails.mimeAllowlist.includes(effectiveMime)) {
      results.push({
        source: "confluence",
        sourcePageId: pageId,
        originalUrl,
        filename: ref.filename,
        mimeType: effectiveMime,
        bytes: rawBytes,
        altText: ref.altText,
        skipped: "unsupported-mime",
      });
      continue;
    }

    // Min-size filter
    if (rawBytes < guardrails.minBytesToKeep) {
      results.push({
        source: "confluence",
        sourcePageId: pageId,
        originalUrl,
        filename: ref.filename,
        mimeType: effectiveMime,
        bytes: rawBytes,
        altText: ref.altText,
        skipped: "too-small",
      });
      continue;
    }

    // Downscale raster if oversized
    let finalBuffer: ArrayBuffer = bytes;
    let downscaled = false;
    let originalBytes: number | undefined;
    try {
      const dr = await downscaleRasterIfOversized(bytes, effectiveMime, {
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
      results.push({
        source: "confluence",
        sourcePageId: pageId,
        originalUrl,
        filename: ref.filename,
        mimeType: effectiveMime,
        bytes: rawBytes,
        altText: ref.altText,
        skipped: "fetch-failed",
      });
      continue;
    }

    const finalBytes = finalBuffer.byteLength;

    // Still too large after downscale? (SVG exempt — vector files aren't downscaled.)
    if (
      finalBytes > guardrails.maxBytesPerImage &&
      effectiveMime !== "image/svg+xml"
    ) {
      results.push({
        source: "confluence",
        sourcePageId: pageId,
        originalUrl,
        filename: ref.filename,
        mimeType: effectiveMime,
        bytes: finalBytes,
        altText: ref.altText,
        skipped: "too-large",
        ...(originalBytes !== undefined ? { originalBytes } : {}),
        ...(downscaled ? { downscaled: true } : {}),
      });
      continue;
    }

    // SVG inline text
    let svgInlineText: string | undefined;
    if (effectiveMime === "image/svg+xml" && guardrails.inlineSvgAsText) {
      try {
        svgInlineText = Buffer.from(finalBuffer).toString("utf-8");
      } catch {
        // Non-fatal
      }
    }

    const entry: EmbeddedImage = {
      source: "confluence",
      sourcePageId: pageId,
      originalUrl,
      filename: ref.filename,
      mimeType: effectiveMime,
      bytes: finalBytes,
      altText: ref.altText,
      ...(downscaled ? { downscaled: true, originalBytes } : {}),
      ...(svgInlineText ? { svgInlineText } : {}),
    };

    // Optional disk save
    if (saveRoot) {
      try {
        const { writeFileSync, mkdirSync, existsSync } = await import("fs");
        const { join } = await import("path");
        const pageDir = join(saveRoot, pageId);
        if (!existsSync(pageDir)) mkdirSync(pageDir, { recursive: true });
        const safeName = sanitizeFilename(ref.filename);
        const diskPath = join(pageDir, safeName);
        writeFileSync(diskPath, Buffer.from(finalBuffer));
        entry.localPath = diskPath;
        if (saveRootRelativeToDraft) {
          entry.relativeToDraft =
            `${saveRootRelativeToDraft}/${pageId}/${safeName}`.replace(/\/+/g, "/");
        }
      } catch {
        // Disk write failed — entry still flows; absence of localPath signals the miss.
      }
    }

    results.push(entry);
  }

  return results;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "image";
}
