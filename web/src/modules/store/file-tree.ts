/** A file of an app, under the folder it sits in. */
export type FileTreeFile = { kind: "file"; name: string; path: string };

/** A folder of an app, holding the files and folders below it. */
export type FileTreeFolder = { kind: "folder"; name: string; path: string; children: FileTreeNode[] };

export type FileTreeNode = FileTreeFile | FileTreeFolder;

/** An app's files, nested into their folders. */
export class FileTree {
  /**
   * Nests an app's file paths (`config/settings.yml`) into folders. At each level the files come before the folders,
   * as in the folder itself the app's own files are what one looks for first.
   */
  static build(paths: string[]): FileTreeNode[] {
    const root: FileTreeFolder = { kind: "folder", name: "", path: "", children: [] };

    for (const filePath of paths) {
      const segments = filePath.split("/");
      const name = segments.pop() ?? filePath;
      let folder = root;

      for (const segment of segments) {
        folder = FileTree.childFolder(folder, segment);
      }

      folder.children.push({ kind: "file", name, path: filePath });
    }

    return FileTree.sort(root.children);
  }

  /** The folder named `name` inside `parent`, added when it is not there yet. */
  private static childFolder(parent: FileTreeFolder, name: string): FileTreeFolder {
    const existing = parent.children.find(child => child.kind === "folder" && child.name === name);

    if (existing?.kind === "folder") {
      return existing;
    }

    const path = parent.path === "" ? name : `${parent.path}/${name}`;
    const folder: FileTreeFolder = { kind: "folder", name, path, children: [] };

    parent.children.push(folder);

    return folder;
  }

  private static sort(nodes: FileTreeNode[]): FileTreeNode[] {
    const sorted = [...nodes].sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "file" ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });

    return sorted.map(node => (node.kind === "folder" ? { ...node, children: FileTree.sort(node.children) } : node));
  }
}
