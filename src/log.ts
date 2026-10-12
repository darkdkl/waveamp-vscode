import * as vscode from "vscode";

let channel: vscode.LogOutputChannel | null = null;

export function initLog(context: vscode.ExtensionContext): void {
  channel = vscode.window.createOutputChannel("WaveAMP", { log: true });
  context.subscriptions.push(channel);
}

export function writeLog(level: "info" | "warn" | "error", scope: string, message: string): void {
  const line = `[${scope}] ${message}`;
  if (level === "error") channel?.error(line);
  else if (level === "warn") channel?.warn(line);
  else channel?.info(line);
}
