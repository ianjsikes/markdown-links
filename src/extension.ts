import * as vscode from "vscode";
import { TextDecoder } from "util";
import * as path from "path";
import { parseFile, parseDirectory } from "./parsing";
import {
  filterNonExistingEdges,
  getColumnSetting,
  getConfiguration,
  getFileTypesSetting,
  id,
  generateBacklinks,
} from "./utils";
import { State } from "./types";

const watch = (
  context: vscode.ExtensionContext,
  panel: vscode.WebviewPanel,
  state: State
) => {
  if (vscode.workspace.rootPath === undefined) {
    return;
  }

  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(
      vscode.workspace.rootPath,
      `**/*{${getFileTypesSetting().join(",")}}`
    ),
    false,
    false,
    false
  );

  const sendGraph = () => {
    panel.webview.postMessage({
      type: "refresh",
      payload: state,
    });
  };

  // Watch file changes in case user adds a link.
  watcher.onDidChange(async (event) => {
    await parseFile(state, event.path);
    filterNonExistingEdges(state);
    generateBacklinks(state);
    sendGraph();
  });

  watcher.onDidDelete(async (event) => {
    let nodeId = id(event.path);
    let node = state.adjacencyList[nodeId];

    if (!node) {
      return;
    }

    delete state.adjacencyList[nodeId];
    for (const node of Object.values(state.adjacencyList)) {
      node.links = node.links.filter((link) => link !== nodeId);
    }

    sendGraph();
  });

  vscode.workspace.onDidOpenTextDocument(async (event) => {
    let path = event.uri.path;
    if (path.endsWith(".git")) {
      path = path.slice(0, -4);
    }
    const nodeId = id(path);
    state.currentNode = nodeId;
    sendGraph();
  });

  vscode.workspace.onDidRenameFiles(async (event) => {
    for (const file of event.files) {
      const previous = file.oldUri.path;
      const prevId = id(previous);
      const next = file.newUri.path;
      const nextId = id(next);

      if (state.adjacencyList[prevId]) {
        state.adjacencyList[nextId] = state.adjacencyList[prevId];
        state.adjacencyList[nextId].path = next;
        delete state.adjacencyList[prevId];
      }

      for (const node of Object.values(state.adjacencyList)) {
        node.links = node.links.map((link) =>
          link === prevId ? nextId : link
        );
      }

      sendGraph();
    }
  });

  panel.webview.onDidReceiveMessage(
    (message) => {
      if (message.type === "ready") {
        sendGraph();
      }
      if (message.type === "click") {
        const openPath = vscode.Uri.file(message.payload.path);
        const column = getColumnSetting("openColumn");

        vscode.workspace.openTextDocument(openPath).then((doc) => {
          vscode.window.showTextDocument(doc, column);
        });
      }
    },
    undefined,
    context.subscriptions
  );

  panel.onDidDispose(() => {
    watcher.dispose();
  });
};

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("markdown-links.showGraph", async () => {
      const currentFilePath =
        vscode.window.activeTextEditor?.document?.uri?.path;
      const column = getColumnSetting("showColumn");

      const panel = vscode.window.createWebviewPanel(
        "markdownLinks",
        "Markdown Links",
        column,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      );

      if (vscode.workspace.rootPath === undefined) {
        vscode.window.showErrorMessage(
          "This command can only be activated in open directory"
        );
        return;
      }

      const state: State = { adjacencyList: {}, currentNode: undefined };

      await parseDirectory(state, vscode.workspace.rootPath, parseFile);
      filterNonExistingEdges(state);
      generateBacklinks(state);

      if (currentFilePath && state.adjacencyList[id(currentFilePath)]) {
        state.currentNode = id(currentFilePath);
      }

      panel.webview.html = await getWebviewContent(context, panel, state);

      watch(context, panel, state);
    })
  );

  const shouldAutoStart = getConfiguration("autoStart");

  if (shouldAutoStart) {
    vscode.commands.executeCommand("markdown-links.showGraph");
  }
}

async function getWebviewContent(
  context: vscode.ExtensionContext,
  panel: vscode.WebviewPanel,
  state: State
) {
  const webviewPath = vscode.Uri.file(
    path.join(context.extensionPath, "static", "webview.html")
  );
  const file = await vscode.workspace.fs.readFile(webviewPath);

  const text = new TextDecoder("utf-8").decode(file);

  const webviewUri = (fileName: string) =>
    panel.webview
      .asWebviewUri(
        vscode.Uri.file(path.join(context.extensionPath, "static", fileName))
      )
      .toString();

  const filled = text
    .replace("--REPLACE-WITH-GRAPH-JS-URI--", webviewUri("graph.js"))
    .replace("--REPLACE-WITH-D3-URI--", webviewUri("d3.min.js"))
    .replace(
      "--REPLACE-WITH-SEEDRANDOM-URI--",
      webviewUri("seedrandom.min.js")
    );

  return filled;
}
