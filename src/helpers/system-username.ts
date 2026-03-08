/**
 * Gets the current user's display name from the OS.
 * Works on macOS and Windows.
 */

import * as os from "os";

export function getSystemUsername(): string {
  try {
    const info = os.userInfo();
    if (info.username && info.username.trim()) {
      return info.username.trim();
    }
  } catch {
    // fall through
  }
  // Unix/macOS
  const unix = process.env.USER?.trim();
  if (unix) return unix;
  // Windows
  const win = process.env.USERNAME?.trim();
  if (win) return win;
  return "Unknown";
}
