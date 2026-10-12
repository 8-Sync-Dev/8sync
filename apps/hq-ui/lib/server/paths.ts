import os from "node:os";
import path from "node:path";

// Resolved per call so tests (and the smoke run) can point HOME elsewhere.
export function stateDir(): string {
  return path.join(os.homedir(), ".local", "state", "8sync", "hq");
}

export function configDir(): string {
  return path.join(os.homedir(), ".config", "8sync", "hq");
}

export const journalFiles = () => ({
  current: path.join(stateDir(), "events.jsonl"),
  rotated: path.join(stateDir(), "events.1.jsonl"),
});

export const dbPath = () => path.join(stateDir(), "hq.db");
export const tokenPath = () => path.join(configDir(), "ui-token");
