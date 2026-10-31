"use client";

import { cn } from "cn";
import { ChevronDownIcon, ChevronRightIcon, FileIcon, FolderIcon, PlusIcon } from "lucide-react";
import { useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { Button } from "#modules/common/ui/button.tsx";
import { Input } from "#modules/common/ui/input.tsx";
import { buildFileTree, type FileTreeFolder, type FileTreeNode } from "#modules/store/file-tree.ts";
import { StoreMessages } from "#modules/store/messages.ts";

/** Indent per nesting level, in rem: a level must read as such at a glance in a narrow column. */
const INDENT_REM = 0.875;

type AppFileTreeProps = {
  paths: string[];
  selectedPath: string;
  /** The files whose draft is not saved yet, marked with a dot */
  unsavedPaths: Set<string>;
  onSelect: (relativePath: string) => void;
  /** Creates an empty file at a relative path, subfolders allowed */
  onCreate: (relativePath: string) => void;
  isCreating: boolean;
};

/**
 * The files of an app, folders collapsible. A column beside the editor from `md` up; below, the same
 * tree folds behind a button naming the open file, and opening a file folds it again.
 */
export function AppFileTree({ paths, selectedPath, unsavedPaths, onSelect, onCreate, isCreating }: AppFileTreeProps) {
  const { t } = useTranslation(StoreMessages);
  const [isOpenOnMobile, setIsOpenOnMobile] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  const toggleFolder = (folderPath: string) =>
    setCollapsedFolders(current => {
      const next = new Set(current);

      if (!next.delete(folderPath)) {
        next.add(folderPath);
      }

      return next;
    });

  const selectFile = (relativePath: string) => {
    setIsOpenOnMobile(false);
    onSelect(relativePath);
  };

  const renderNodes = (nodes: FileTreeNode[], depth: number) =>
    nodes.map(node => (
      <li key={node.path}>
        {node.kind === "folder" ? (
          <FolderRow folder={node} depth={depth} isCollapsed={collapsedFolders.has(node.path)} onToggle={toggleFolder}>
            {renderNodes(node.children, depth + 1)}
          </FolderRow>
        ) : (
          <FileRow
            name={node.name}
            depth={depth}
            isSelected={node.path === selectedPath}
            isUnsaved={unsavedPaths.has(node.path)}
            onSelect={() => selectFile(node.path)}
          />
        )}
      </li>
    ));

  return (
    <nav aria-label={t("editor.filesLabel")} className="flex flex-col gap-1 rounded-lg border border-input p-1.5">
      <Button
        type="button"
        variant="ghost"
        className="justify-between font-mono md:hidden"
        aria-expanded={isOpenOnMobile}
        onClick={() => setIsOpenOnMobile(open => !open)}
      >
        <span className="truncate">
          {selectedPath}
          {unsavedPaths.has(selectedPath) && <UnsavedDot />}
        </span>
        <ChevronDownIcon className={cn("transition-transform", isOpenOnMobile && "rotate-180")} />
      </Button>
      <div className={cn("flex-col gap-1", isOpenOnMobile ? "flex" : "hidden", "md:flex")}>
        <p className="px-2 pt-1 text-xs font-medium text-muted-foreground">{t("editor.files")}</p>
        <ul className="flex flex-col">{renderNodes(buildFileTree(paths), 0)}</ul>
        <NewFileForm onCreate={onCreate} isCreating={isCreating} />
      </div>
    </nav>
  );
}

type FolderRowProps = {
  folder: FileTreeFolder;
  depth: number;
  isCollapsed: boolean;
  onToggle: (folderPath: string) => void;
  children: ReactNode;
};

function FolderRow({ folder, depth, isCollapsed, onToggle, children }: FolderRowProps) {
  const Chevron = isCollapsed ? ChevronRightIcon : ChevronDownIcon;

  return (
    <>
      <TreeRow depth={depth} aria-expanded={!isCollapsed} onClick={() => onToggle(folder.path)}>
        <Chevron />
        <FolderIcon />
        <span className="truncate">{folder.name}/</span>
      </TreeRow>
      {!isCollapsed && <ul className="flex flex-col">{children}</ul>}
    </>
  );
}

type FileRowProps = {
  name: string;
  depth: number;
  isSelected: boolean;
  isUnsaved: boolean;
  onSelect: () => void;
};

function FileRow({ name, depth, isSelected, isUnsaved, onSelect }: FileRowProps) {
  return (
    <TreeRow
      depth={depth}
      aria-current={isSelected ? "page" : undefined}
      className={cn(isSelected && "bg-muted text-foreground")}
      onClick={onSelect}
    >
      <FileIcon />
      <span className="truncate">{name}</span>
      {isUnsaved && <UnsavedDot />}
    </TreeRow>
  );
}

type TreeRowProps = ComponentProps<"button"> & { depth: number };

/** One clickable line of the tree, indented by its depth. */
function TreeRow({ depth, className, style, ...props }: TreeRowProps) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left font-mono text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&_svg]:size-3.5 [&_svg]:shrink-0",
        className,
      )}
      style={{ paddingLeft: `${0.5 + depth * INDENT_REM}rem`, ...style }}
      {...props}
    />
  );
}

function UnsavedDot() {
  const { t } = useTranslation(StoreMessages);

  return (
    <span className="ml-auto pl-1.5 text-primary" role="img" aria-label={t("editor.unsaved")}>
      ●
    </span>
  );
}

type NewFileFormProps = {
  onCreate: (relativePath: string) => void;
  isCreating: boolean;
};

/** "New file": a button, then a path input; Escape or an empty name puts the button back. */
function NewFileForm({ onCreate, isCreating }: NewFileFormProps) {
  const { t } = useTranslation(StoreMessages);
  const [isEditing, setIsEditing] = useState(false);
  const [relativePath, setRelativePath] = useState("");

  const close = () => {
    setIsEditing(false);
    setRelativePath("");
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmed = relativePath.trim();

    if (trimmed.length > 0) {
      onCreate(trimmed);
    }

    close();
  };

  if (!isEditing) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="justify-start"
        disabled={isCreating}
        onClick={() => setIsEditing(true)}
      >
        <PlusIcon data-icon="inline-start" />
        {t("editor.newFile")}
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <Input
        autoFocus
        aria-label={t("editor.newFilePath")}
        value={relativePath}
        placeholder="config/settings.yml"
        className="font-mono"
        onChange={event => setRelativePath(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Escape") {
            close();
          }
        }}
      />
    </form>
  );
}
