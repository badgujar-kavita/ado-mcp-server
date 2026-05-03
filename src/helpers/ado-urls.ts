import type { AdoClient } from "../ado-client.ts";

export function adoWorkItemUrl(adoClient: AdoClient, id: number): string {
  return `${adoClient.baseUrl}/_workitems/edit/${id}`;
}
