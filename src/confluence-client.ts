import type { ConfluencePageResult } from "./types.ts";

function buildAuthHeader(email: string, apiToken: string): string {
  return `Basic ${Buffer.from(email + ":" + apiToken).toString("base64")}`;
}

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
  private baseUrl: string;
  private authHeader: string;

  constructor(baseUrl: string, email: string, apiToken: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.authHeader = buildAuthHeader(email, apiToken);
  }

  async getPageContent(pageId: string): Promise<ConfluencePageResult> {
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
      return {
        title: data.title,
        body: this.stripHtml(data.body.storage.value),
      };
    }

    if (response.status === 401) {
      const fallback = await this.tryApiAtlassianFallback(pageId);
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

  /** Fallback for scoped API tokens that require api.atlassian.com endpoint */
  private async tryApiAtlassianFallback(
    pageId: string
  ): Promise<ConfluencePageResult | null> {
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
    return {
      title: data.title,
      body: this.stripHtml(data.body.storage.value),
    };
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<\/h[1-6]>/gi, "\n\n")
      .replace(/<h[1-6][^>]*>/gi, "## ")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
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
