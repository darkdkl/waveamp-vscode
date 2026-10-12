import * as vscode from "vscode";
import { t } from "./i18n";
import { AUDIO_EXTENSIONS, audioFilesIn, localDialogStart, localFiles } from "./library";
import { radioSourcesFile, refreshRadioMirrors } from "./radio/api";
import type { PlayerCommand } from "./shared/messages";
import type { PlayerView } from "./view";

export function registerCommands(context: vscode.ExtensionContext, view: PlayerView): vscode.Disposable[] {
  const command = (name: PlayerCommand) => () => view.post({ type: "command", name });
  return [
    vscode.commands.registerCommand("waveamp.addFiles", async () => {
      const picked = await vscode.window.showOpenDialog({
        ...localDialogStart(),
        canSelectMany: true,
        filters: { Audio: [...AUDIO_EXTENSIONS, "cue"] },
        title: t.addFiles,
      });
      await view.addPaths(localFiles(picked));
    }),
    vscode.commands.registerCommand("waveamp.addFolder", async () => {
      const picked = await vscode.window.showOpenDialog({ ...localDialogStart(), canSelectFolders: true, canSelectFiles: false, title: t.addFolder });
      const [folder] = localFiles(picked);
      if (folder) await view.addPaths(await audioFilesIn(folder));
    }),
    vscode.commands.registerCommand("waveamp.playPause", command("playPause")),
    vscode.commands.registerCommand("waveamp.stop", command("stop")),
    vscode.commands.registerCommand("waveamp.next", command("next")),
    vscode.commands.registerCommand("waveamp.previous", command("previous")),
    vscode.commands.registerCommand("waveamp.saveTrack", command("saveTrack")),
    vscode.commands.registerCommand("waveamp.addStation", async () => {
      await vscode.commands.executeCommand("waveamp.player.focus");
      view.post({ type: "command", name: "addStation" });
    }),
    vscode.commands.registerCommand("waveamp.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", `@ext:${context.extension.id}`)
    ),
    vscode.commands.registerCommand("waveamp.openRadioSources", async () => {
      await vscode.window.showTextDocument(vscode.Uri.file(radioSourcesFile()));
    }),
    vscode.commands.registerCommand("waveamp.refreshRadioMirrors", async () => {
      const mirror = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: t.mirrorsSearching },
        () => refreshRadioMirrors()
      );
      if (mirror) {
        void vscode.window.showInformationMessage(t.mirrorFound.replace("{0}", new URL(mirror).host));
        return;
      }
      const choice = await vscode.window.showWarningMessage(t.mirrorsNotFound, t.openRadioSources);
      if (choice) await vscode.commands.executeCommand("waveamp.openRadioSources");
    }),
  ];
}
