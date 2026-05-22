import type {
  ConfluencePageResult,
  ConfluencePageResultRaw,
  ConfluenceAttachmentListItem,
  ConfluenceBinaryResponse,
} from "./types.ts";
import { basicAuthHeader } from "./helpers/basic-auth.ts";
import {
  extractTinyUrlPath,
  tinyUrlToPageId,
} from "./helpers/confluence-url.ts";
import { stripHtml } from "./helpers/strip-html.ts";

/** Extract site host from base URL, e.g. your-org.atlassian.net from https://your-org.atlassian.net/wiki */
function extractSiteHost(baseUrl: string): string | null {
  try {
    const u = new URL(baseUrl);
    return u.hostname;
  } catch {
    return null;
  }
}

/** Fetch cloud ID from tenant_info (no auth required) */
async function fetchCloudId(siteHost: string): Promise<string | null> {
  try {
    const res = await fetch(`https://${siteHost}/_edge/tenant_info`);
    if (!res.ok) return null;
    const data = (await res.json()) as { cloudId?: string };
    return data.cloudId ?? null;
  } catch {
    return null;
  }
}

export class ConfluenceClient {
  readonly baseUrl: string;
  private readonly authHeader: string;
  /** Cached cloudId for api.atlassian.com fallback. `undefined` = not yet looked up; `null` = lookup failed or not an atlassian.net site. */
  private _cloudId: string | null | undefined = undefined;

  constructor(baseUrl: string, email: string, apiToken: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.authHeader = basicAuthHeader(email, apiToken);
  }

  /** Resolve (and cache) cloudId for this tenant; returns null if not an atlassian.net site or tenant lookup fails. */
  private async _getCloudId(): Promise<string | null> {
    if (this._cloudId !== undefined) return this._cloudId;
    const siteHost = extractSiteHost(this.baseUrl);
    if (!siteHost || !siteHost.includes("atlassian.net")) {
      this._cloudId = null;
      return null;
    }
    this._cloudId = await fetchCloudId(siteHost);
    return this._cloudId;
  }

  /**
   * Resolve a relative Confluence URL/path to an api.atlassian.com form that
   * scoped tokens can reach. Returns null when fallback isn't available.
   * Primary-base form is `${baseUrl}${relative}`; fallback form strips the
   * `/wiki` prefix (baseUrl path) and prepends `/ex/confluence/{cloudId}/wiki`.
   */
  private async _toApiAtlassianUrl(urlOrPath: string): Promise<string | null> {
    const cloudId = await this._getCloudId();
    if (!cloudId) return null;
    if (urlOrPath.startsWith("http")) {
      try {
        const u = new URL(urlOrPath);
        // Mirror the same path onto api.atlassian.com
        return `https://api.atlassian.com/ex/confluence/${cloudId}${u.pathname}${u.search}`;
      } catch {
        return null;
      }
    }
    const path = urlOrPath.startsWith("/") ? urlOrPath : `/${urlOrPath}`;
    // baseUrl has no trailing slash; its pathname is usually `/wiki`
    const basePath = new URL(this.baseUrl).pathname; // e.g. "/wiki"
    // Build the full primary path (basePath + path), then prefix with /ex/confluence/{cloudId}
    return `https://api.atlassian.com/ex/confluence/${cloudId}${basePath}${path}`;
  }

  async getPageContent(pageId: string): Promise<ConfluencePageResult> {
    const { title, rawStorageHtml } = await this._fetchPage(pageId);
    return { title, body: stripHtml(rawStorageHtml) };
  }

  /**
   * Resolve a Confluence "tiny URL" (the `/wiki/x/{token}` short link
   * Confluence's "Copy link" button produces by default) to a canonical URL
   * containing a numeric pageId.
   *
   * **Primary path: offline decode.** The token is `pageId` encoded as
   * little-endian bytes (trailing zeros stripped) then base64url-encoded.
   * `tinyUrlToPageId()` reverses that purely in memory — no network, no
   * authentication, works on any tenant. We synthesize a minimal canonical
   * URL (`${baseUrl}/pages/{id}/x`) so callers downstream can extract the
   * pageId via `extractConfluencePageIdFromUrl()` exactly as they do for any
   * other Confluence link. The "/x" leaf is a placeholder slug; Confluence
   * accepts any non-empty string there and the API only reads the numeric ID.
   *
   * **Fallback path: 302 redirect probe.** Retained for the rare cases
   * where the offline algorithm doesn't apply: legacy self-hosted
   * Confluence Server installs that may use a different encoding, or
   * future tenant-specific shortener variants. Authenticated GET against
   * `${baseUrl}${path}` with `redirect: 'manual'`; on 401 falls back to
   * `api.atlassian.com/ex/confluence/{cloudId}` for scoped tokens. Returns
   * the `Location` header value on 3xx.
   *
   * Returns null when both paths fail (unrecognized token AND redirect
   * probe couldn't reach the page). Never throws — callers fall through to
   * the existing "unfetched link" reporting on null.
   */
  async resolveTinyUrl(urlOrPath: string): Promise<string | null> {
    const tinyPath = extractTinyUrlPath(urlOrPath);
    if (!tinyPath) return null;

    // Primary path: pure-function decode. Wins for ~all Confluence Cloud
    // tenants — no auth, no network, no edge-case redirect handling.
    const decodedPageId = tinyUrlToPageId(urlOrPath);
    if (decodedPageId) {
      return `${this.baseUrl}/pages/${decodedPageId}/x`;
    }

    // Fallback path: 302 redirect probe. Same logic as before.
    // Absolute URL → use as-is (mirrors fetchAttachmentBinary's pattern, which
    // avoids double-`/wiki` when the input already includes the baseUrl path).
    // Relative path → prefix baseUrl. _toApiAtlassianUrl always works from the
    // path form, so 401-fallback is consistent regardless of input shape.
    const primaryUrl = urlOrPath.startsWith("http")
      ? urlOrPath
      : `${this.baseUrl}${tinyPath}`;
    const location = await this._fetchTinyUrlLocation(primaryUrl);
    if (location) return location;

    // 401 fallback path: scoped tokens reject site-URL calls and need the
    // api.atlassian.com proxy. Mirror the same path under /ex/confluence/{cloudId}.
    // `_toApiAtlassianUrl` prepends `basePath` (`/wiki` for cloud), so we must
    // strip a leading `/wiki` from `tinyPath` before passing it in — otherwise
    // the helper produces `/wiki/wiki/x/{token}` and the proxy 404s.
    const proxyPath = tinyPath.startsWith("/wiki/") ? tinyPath.slice(5) : tinyPath;
    const fallbackUrl = await this._toApiAtlassianUrl(proxyPath);
    if (fallbackUrl) {
      const fbLocation = await this._fetchTinyUrlLocation(fallbackUrl);
      if (fbLocation) return fbLocation;
    }

    return null;
  }

  /** GET the tiny URL with manual-redirect, return Location on 3xx or null otherwise. */
  private async _fetchTinyUrlLocation(url: string): Promise<string | null> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        headers: {
          Authorization: this.authHeader,
          // No Accept header — we only care about the redirect target.
        },
      });
    } catch {
      return null;
    }

    // `redirect: 'manual'` surfaces 3xx responses with the Location header
    // intact; an authenticated tiny URL on a visible page returns 302.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      // Some tenants emit a relative Location (e.g. `/wiki/spaces/...`); resolve
      // it against the original request URL so callers always get an absolute URL.
      try {
        return new URL(location, url).toString();
      } catch {
        return null;
      }
    }
    return null;
  }

  async getPageContentRaw(pageId: string): Promise<ConfluencePageResultRaw> {
    const { title, rawStorageHtml } = await this._fetchPage(pageId);
    return { title, body: stripHtml(rawStorageHtml), rawStorageHtml };
  }

  /** Shared fetch logic that returns both the title and the raw storage HTML. */
  private async _fetchPage(
    pageId: string
  ): Promise<{ title: string; rawStorageHtml: string }> {
    const siteUrl = `${this.baseUrl}/rest/api/content/${pageId}?expand=body.storage`;
    const response = await fetch(siteUrl, {
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
      },
    });

    if (response.ok) {
      const data = (await response.json()) as {
        title: string;
        body: { storage: { value: string } };
      };
      return { title: data.title, rawStorageHtml: data.body.storage.value };
    }

    if (response.status === 401) {
      const fallback = await this._tryApiAtlassianFallbackRaw(pageId);
      if (fallback) return fallback;
    }

    const body = await response.text().catch(() => "");
    const status = response.status;
    let hint = "";
    if (status === 401) {
      hint =
        " Check: (1) confluence_base_url is https://yoursite.atlassian.net/wiki (no /spaces/...), " +
        "(2) confluence_email matches your Atlassian account, (3) API token is valid (create new at id.atlassian.com/manage-profile/security/api-tokens), " +
        "(4) you have 'Can view' on the Confluence space.";
    }
    throw new Error(
      `Confluence API error (${status}): ${body || response.statusText}${hint}`
    );
  }

  /** Fallback for scoped API tokens that require api.atlassian.com endpoint. Returns raw storage HTML. */
  private async _tryApiAtlassianFallbackRaw(
    pageId: string
  ): Promise<{ title: string; rawStorageHtml: string } | null> {
    const siteHost = extractSiteHost(this.baseUrl);
    if (!siteHost || !siteHost.includes("atlassian.net")) return null;

    const cloudId = await fetchCloudId(siteHost);
    if (!cloudId) return null;

    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/rest/api/content/${pageId}?expand=body.storage`;
    const response = await fetch(url, {
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
      },
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      title: string;
      body: { storage: { value: string } };
    };
    return { title: data.title, rawStorageHtml: data.body.storage.value };
  }

  /**
   * List current attachments on a Confluence page.
   *
   * Returns an array of `{ id, title, mediaType, fileSize?, version, downloadUrl }`.
   * `downloadUrl` may be relative (e.g. `/wiki/download/attachments/{pageId}/{filename}?...`) —
   * `fetchAttachmentBinary` handles joining against `baseUrl`.
   *
   * Returns `[]` on 404 (page missing or no attachments endpoint); throws on other errors.
   */
  async listAttachments(
    pageId: string
  ): Promise<ConfluenceAttachmentListItem[]> {
    const path = `/rest/api/content/${pageId}/child/attachment?expand=version,metadata&limit=200`;

    let response = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
      },
    });

    // 401 fallback: scoped tokens reject site-URL calls and need api.atlassian.com
    if (response.status === 401) {
      const fallback = await this._toApiAtlassianUrl(path);
      if (fallback) {
        response = await fetch(fallback, {
          headers: {
            Authorization: this.authHeader,
            Accept: "application/json",
          },
        });
      }
    }

    if (!response.ok) {
      if (response.status === 404) return [];
      throw new Error(
        `Confluence listAttachments failed: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as {
      results?: Array<{
        id: string;
        title: string;
        metadata?: { mediaType?: string };
        extensions?: { fileSize?: number; mediaType?: string };
        version?: { number?: number };
        _links?: { download?: string };
      }>;
    };

    return (data.results ?? [])
      .map((item): ConfluenceAttachmentListItem | null => {
        const downloadUrl = item._links?.download;
        if (!downloadUrl) return null;
        return {
          id: item.id,
          title: item.title,
          mediaType:
            item.metadata?.mediaType ??
            item.extensions?.mediaType ??
            "application/octet-stream",
          fileSize: item.extensions?.fileSize,
          version: { number: item.version?.number ?? 1 },
          downloadUrl,
        };
      })
      .filter((x): x is ConfluenceAttachmentListItem => x !== null);
  }

  /**
   * Download an attachment's raw bytes.
   *
   * Accepts either an absolute URL or a relative path (e.g. `/wiki/download/...`
   * or `download/...`). Relative paths are resolved against `baseUrl`.
   */
  async fetchAttachmentBinary(
    urlOrPath: string
  ): Promise<ConfluenceBinaryResponse> {
    const primaryUrl = urlOrPath.startsWith("http")
      ? urlOrPath
      : `${this.baseUrl}${urlOrPath.startsWith("/") ? "" : "/"}${urlOrPath}`;

    let response = await fetch(primaryUrl, {
      headers: {
        Authorization: this.authHeader,
        // No Accept header — let server send whatever content type matches the file.
      },
    });

    // 401 fallback: scoped tokens reject site-URL calls and need api.atlassian.com
    let finalUrl = primaryUrl;
    if (response.status === 401) {
      const fallback = await this._toApiAtlassianUrl(urlOrPath);
      if (fallback) {
        finalUrl = fallback;
        response = await fetch(fallback, {
          headers: { Authorization: this.authHeader },
        });
      }
    }

    if (!response.ok) {
      throw new Error(
        `Confluence attachment fetch failed (${response.status}): ${finalUrl}`
      );
    }

    const buffer = await response.arrayBuffer();
    const mimeType =
      response.headers.get("content-type")?.split(";")[0].trim() ?? null;
    return { buffer, mimeType };
  }
}

export function createConfluenceClient(
  baseUrl?: string,
  email?: string,
  apiToken?: string
): ConfluenceClient | null {
  const url = baseUrl || process.env.CONFLUENCE_BASE_URL;
  const mail = email || process.env.CONFLUENCE_EMAIL;
  const token = apiToken || process.env.CONFLUENCE_API_TOKEN;
  if (!url || !mail || !token) return null;
  return new ConfluenceClient(url, mail, token);
}
