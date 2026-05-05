import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";

const CREDENTIALS_DIR = join(homedir(), ".vortex-ado");
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");

const PLACEHOLDER_VALUES = [
  "your-personal-access-token",
  "your-organization-name",
  "your-project-name",
];

export interface Credentials {
  ado_pat: string;
  ado_org: string;
  ado_project: string;
  confluence_base_url?: string;
  confluence_email?: string;
  confluence_api_token?: string;
  /** Optional: fixed path for tc-drafts. When set, drafts go here. Otherwise use workspaceRoot or draftsPath from tools. */
  tc_drafts_path?: string;
}

export function getCredentialsPath(): string {
  return CREDENTIALS_FILE;
}

/** User-configured tc-drafts path from env or credentials. Returns null if not set (no hardcoded default). */
export function getTcDraftsDir(): string | null {
  const fromEnv = process.env.TC_DRAFTS_PATH?.trim();
  if (fromEnv) return resolve(fromEnv);

  const creds = loadCredentials();
  if (creds?.tc_drafts_path) return creds.tc_drafts_path;

  return null;
}

export function loadCredentials(): Credentials | null {
  if (!existsSync(CREDENTIALS_FILE)) return null;

  try {
    const raw = readFileSync(CREDENTIALS_FILE, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;

    const pat = (data.ado_pat as string) ?? "";
    const org = (data.ado_org as string) ?? "";
    const project = (data.ado_project as string) ?? "";

    if (!pat || !org || !project) return null;
    if (PLACEHOLDER_VALUES.includes(pat) || PLACEHOLDER_VALUES.includes(org) || PLACEHOLDER_VALUES.includes(project)) {
      return null;
    }

    const tcDraftsPathRaw = (data.tc_drafts_path as string)?.trim();
    const tcDraftsPath = tcDraftsPathRaw ? resolve(tcDraftsPathRaw) : undefined;

    return {
      ado_pat: pat,
      ado_org: org,
      ado_project: project,
      confluence_base_url: (data.confluence_base_url as string) || undefined,
      confluence_email: (data.confluence_email as string) || undefined,
      confluence_api_token: (data.confluence_api_token as string) || undefined,
      tc_drafts_path: tcDraftsPath,
    };
  } catch {
    return null;
  }
}

export function credentialsFileExists(): boolean {
  return existsSync(CREDENTIALS_FILE);
}

export function createCredentialsTemplate(): string {
  if (!existsSync(CREDENTIALS_DIR)) {
    mkdirSync(CREDENTIALS_DIR, { recursive: true });
  }

  if (!existsSync(CREDENTIALS_FILE)) {
    const template: Record<string, string> = {
      ado_pat: "your-personal-access-token",
      ado_org: "your-organization-name",
      ado_project: "your-project-name",
      confluence_base_url: "",
      confluence_email: "",
      confluence_api_token: "",
      tc_drafts_path: "",
    };
    writeFileSync(CREDENTIALS_FILE, JSON.stringify(template, null, 2) + "\n", "utf-8");
  }

  return CREDENTIALS_FILE;
}
