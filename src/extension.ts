import * as vscode from "vscode";
import { registerCommands } from "./commands";
import { t } from "./i18n";
import { initLog } from "./log";
import { initRadioMirrors } from "./radio/api";
import { startMediaServer } from "./server";
import { applyProxySettings } from "./settings";
import { FAVORITES_KEY, PlayerView, SAVED_TRACKS_KEY } from "./view";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  initLog(context);
  applyProxySettings();
  initRadioMirrors(context.globalStorageUri.fsPath, context.asAbsolutePath("media/radio-sources.json"));
  context.globalState.setKeysForSync([FAVORITES_KEY, SAVED_TRACKS_KEY]);
  let view: PlayerView | undefined;
  const server = await startMediaServer((source, title) => view?.post({ type: "nowPlaying", source, title }));
  server.usePublicOrigin((await vscode.env.asExternalUri(vscode.Uri.parse(server.origin))).toString(true));
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = "waveamp.playPause";
  view = new PlayerView(context, server, status, t);

  context.subscriptions.push(
    status,
    { dispose: () => server.close() },
    vscode.window.registerWebviewViewProvider("waveamp.player", view, { webviewOptions: { retainContextWhenHidden: true } }),
    ...registerCommands(context, view),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("waveamp.proxy")) applyProxySettings();
      if (event.affectsConfiguration("waveamp")) view?.postSettings();
    })
  );
}

export function deactivate(): void {}
