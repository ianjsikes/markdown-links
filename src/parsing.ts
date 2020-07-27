import * as vscode from "vscode";
import * as path from "path";
import * as unified from "unified";
import * as markdown from "remark-parse";
import * as wikiLinkPlugin from "remark-wiki-link";
import * as frontmatter from "remark-frontmatter";
import { MarkdownNode, State } from "./types";
import { TextDecoder } from "util";
import { findTitle, findLinks, id, getFileTypesSetting } from "./utils";

const parser = unified().use(markdown).use(wikiLinkPlugin).use(frontmatter);

export const parseFile = async (state: State, filePath: string) => {
  const buffer = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
  const content = new TextDecoder("utf-8").decode(buffer);
  const ast: MarkdownNode = parser.parse(content);

  let title: string | null = findTitle(ast);
  let nodeId = id(filePath);
  let node = state.adjacencyList[nodeId];

  if (!title) {
    if (node) {
      delete state.adjacencyList[nodeId];
    }

    return;
  }

  if (node) {
    node.label = title;
  } else {
    node = {
      id: id(filePath),
      path: filePath,
      label: title,
      links: [],
      backlinks: [],
    };
    state.adjacencyList[id(filePath)] = node;
  }

  const links = findLinks(ast);
  const parentDirectory = filePath.split("/").slice(0, -1).join("/");
  let linkSet = new Set<string>();

  for (const link of links) {
    let target = link;
    if (!path.isAbsolute(link)) {
      target = path.normalize(`${parentDirectory}/${link}`);
    }
    if (target.endsWith("#")) {
      continue;
    }
    linkSet.add(id(target));
  }
  node.links = Array.from(linkSet);
};

export const parseDirectory = async (
  state: State,
  directory: string,
  fileCallback: (state: State, path: string) => Promise<void>
) => {
  const files = await vscode.workspace.fs.readDirectory(
    vscode.Uri.file(directory)
  );

  const promises: Promise<void>[] = [];

  for (const file of files) {
    const fileName = file[0];
    const fileType = file[1];
    const isDirectory = fileType === vscode.FileType.Directory;
    const isFile = fileType === vscode.FileType.File;
    const hiddenFile = fileName.startsWith(".");
    const isGraphFile = getFileTypesSetting().includes(
      fileName.substr(fileName.lastIndexOf(".") + 1)
    );

    if (isDirectory && !hiddenFile) {
      promises.push(
        parseDirectory(state, `${directory}/${fileName}`, fileCallback)
      );
    } else if (isFile && isGraphFile) {
      promises.push(fileCallback(state, `${directory}/${fileName}`));
    }
  }

  await Promise.all(promises);
};
