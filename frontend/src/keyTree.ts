import type { KeyInfo } from "./types";

export const KEY_DELIMITER = ":";

export interface KeyFolder {
  name: string;
  path: string;
  folders: KeyFolder[];
  keys: KeyInfo[];
  count: number;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function buildKeyTree(keys: KeyInfo[], delimiter = KEY_DELIMITER): KeyFolder {
  const root: KeyFolder = { name: "", path: "", folders: [], keys: [], count: 0 };
  const folders = new Map<string, KeyFolder>([["", root]]);

  for (const key of keys) {
    const segments = key.key.split(delimiter).filter((segment) => segment.length > 0);
    if (segments.length <= 1) {
      root.keys.push(key);
      continue;
    }

    let parent = root;
    let path = "";

    for (let i = 0; i < segments.length - 1; i++) {
      path = path === "" ? segments[i] : `${path}${delimiter}${segments[i]}`;

      let folder = folders.get(path);
      if (!folder) {
        folder = { name: segments[i], path, folders: [], keys: [], count: 0 };
        folders.set(path, folder);
        parent.folders.push(folder);
      }
      parent = folder;
    }

    parent.keys.push(key);
  }

  const finalize = (folder: KeyFolder): number => {
    folder.folders.sort((a, b) => collator.compare(a.name, b.name));
    folder.keys.sort((a, b) => collator.compare(a.key, b.key));

    let count = folder.keys.length;
    for (const child of folder.folders) {
      count += finalize(child);
    }
    folder.count = count;
    return count;
  };

  finalize(root);
  return root;
}

export function collectFolderPaths(folder: KeyFolder, out: string[] = []): string[] {
  for (const child of folder.folders) {
    out.push(child.path);
    collectFolderPaths(child, out);
  }
  return out;
}

export function keyLeafLabel(key: string, delimiter = KEY_DELIMITER): string {
  const segments = key.split(delimiter).filter((segment) => segment.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : key;
}
