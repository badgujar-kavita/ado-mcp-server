export class AdoClientError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public statusText: string
  ) {
    super(message);
    this.name = "AdoClientError";
  }
}

import { basicAuthHeader } from "./helpers/basic-auth.ts";

export interface BinaryResponse {
  buffer: ArrayBuffer;
  mimeType: string | null;
}

export class AdoClient {
  readonly baseUrl: string;
  private authHeader: string;

  constructor(org: string, project: string, pat: string) {
    this.baseUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}`;
    this.authHeader = basicAuthHeader("", pat);
  }

  private buildUrl(path: string, apiVersion: string, queryParams?: Record<string, string>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("api-version", apiVersion);
    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  private async request<T>(
    method: string,
    path: string,
    options: {
      apiVersion?: string;
      body?: unknown;
      contentType?: string;
      queryParams?: Record<string, string>;
    } = {}
  ): Promise<T> {
    const {
      apiVersion = "7.1",
      body,
      contentType = "application/json",
      queryParams,
    } = options;

    const url = this.buildUrl(path, apiVersion, queryParams);
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: "application/json",
    };
    if (body !== undefined) {
      headers["Content-Type"] = contentType;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      const message = this.mapError(response.status, errorBody);
      throw new AdoClientError(message, response.status, response.statusText);
    }

    if (response.status === 204) return {} as T;
    return (await response.json()) as T;
  }

  private async requestBinary(
    path: string,
    options: {
      apiVersion?: string;
      queryParams?: Record<string, string>;
    } = {}
  ): Promise<BinaryResponse> {
    const { apiVersion = "7.1", queryParams } = options;
    const url = this.buildUrl(path, apiVersion, queryParams);
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      // No Accept header — we want whatever bytes the server sends.
    };

    const response = await fetch(url, { method: "GET", headers });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      const message = this.mapError(response.status, errorBody);
      throw new AdoClientError(message, response.status, response.statusText);
    }

    const buffer = await response.arrayBuffer();
    const mimeType = response.headers.get("content-type")?.split(";")[0].trim() ?? null;
    return { buffer, mimeType };
  }

  private mapError(status: number, body: string): string {
    switch (status) {
      case 401:
        return "Authentication failed. Check that your ADO_PAT is valid and not expired.";
      case 403:
        return "Insufficient permissions. Ensure your PAT has vso.work_write and vso.test_write scopes.";
      case 404:
        return `Resource not found. Verify the organization, project, and resource IDs. Details: ${body}`;
      default:
        return `Azure DevOps API error (${status}): ${body}`;
    }
  }

  async get<T>(path: string, apiVersion?: string, queryParams?: Record<string, string>): Promise<T> {
    return this.request<T>("GET", path, { apiVersion, queryParams });
  }

  async getBinary(
    path: string,
    apiVersion?: string,
    queryParams?: Record<string, string>
  ): Promise<BinaryResponse> {
    return this.requestBinary(path, { apiVersion, queryParams });
  }

  async post<T>(path: string, body: unknown, contentType?: string, apiVersion?: string): Promise<T> {
    return this.request<T>("POST", path, { apiVersion, body, contentType });
  }

  async patch<T>(path: string, body: unknown, contentType?: string, apiVersion?: string): Promise<T> {
    return this.request<T>("PATCH", path, { apiVersion, body, contentType });
  }

  async delete<T>(path: string, apiVersion?: string, queryParams?: Record<string, string>): Promise<T> {
    return this.request<T>("DELETE", path, { apiVersion, queryParams });
  }
}
