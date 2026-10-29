/** A file of an app, under the folder it sits in. */
export type FileTreeFile = { kind: "file"; name: string; path: string };

/** A folder of an app, holding the files and folders below it. */
export type FileTreeFolder = { kind: "folder"; name: string; path: string; children: FileTreeNode[] };

export type FileTreeNode = FileTreeFile | FileTreeFolder;

/**
 * Nests an app's relative file paths (`config/settings.yml`) into folders. At each level the files
 * come before the folders, as in the folder itself the app's own files are what one looks for first.
 */
export function buildFileTree(paths: string[]): FileTreeNode[] {
  const root: FileTreeFolder = { kind: "folder", name: "", path: "", children: [] };

  for (const filePath of paths) {
    const segments = filePath.split("/");
    const name = segments.pop()!;
    let folder = root;

    for (const segment of segments) {
      folder = childFolder(folder, segment);
    }

    folder.children.push({ kind: "file", name, path: filePath });
  }

  return sortTree(root.children);
}

/** The folder named `name` inside `parent`, added when it is not there yet. */
function childFolder(parent: FileTreeFolder, name: string): FileTreeFolder {
  const existing = parent.children.find(child => child.kind === "folder" && child.name === name);

  if (existing?.kind === "folder") {
    return existing;
  }

  const path = parent.path === "" ? name : `${parent.path}/${name}`;
  const folder: FileTreeFolder = { kind: "folder", name, path, children: [] };

  parent.children.push(folder);

  return folder;
}

function sortTree(nodes: FileTreeNode[]): FileTreeNode[] {
  const sorted = [...nodes].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "file" ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });

  return sorted.map(node => (node.kind === "folder" ? { ...node, children: sortTree(node.children) } : node));
}
