import { cn } from "cn";
import { ChevronDownIcon, ChevronRightIcon, FileIcon, FolderIcon, PlusIcon } from "lucide-react";
import { useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { Button } from "#modules/common/ui/button.tsx";
import { FieldError } from "#modules/common/ui/field.tsx";
import { Input } from "#modules/common/ui/input.tsx";
import { buildFileTree, type FileTreeFolder, type FileTreeNode } from "#modules/store/helpers/file-tree.ts";
import { m } from "#paraglide/messages.js";

/** How the tree lays out its rows: the indent per nesting level, in rem: a level must read as such at a glance in a narrow column. */
const indentRem = 0.875;

type AppFileTreeProps = {
  paths: string[];
  selectedPath: string;
  /** The files whose draft is not saved yet, marked with a dot */
  unsavedPaths: Set<string>;
  onSelect: (relativePath: string) => void;
  /**
   * Creates an empty file at a relative path, subfolders allowed: resolves to why the server refused it, shown under
   * the path, or to `undefined` once the file is there.
   */
  onCreate: (relativePath: string) => Promise<string | undefined>;
  isCreating: boolean;
};

/**
 * The files of an app, folders collapsible. A column beside the editor from `md` up; below, the same
 * tree folds behind a button naming the open file, and opening a file folds it again.
 */
export function AppFileTree({ paths, selectedPath, unsavedPaths, onSelect, onCreate, isCreating }: AppFileTreeProps) {
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
    <nav aria-label={m.store_editor_files()} className="flex flex-col gap-1 rounded-lg border border-input p-1.5">
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
        <p className="px-2 pt-1 text-xs font-medium text-muted-foreground">{m.store_editor_files_title()}</p>
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
      style={{ paddingLeft: `${0.5 + depth * indentRem}rem`, ...style }}
      {...props}
    />
  );
}

function UnsavedDot() {
  return (
    <span className="ml-auto pl-1.5 text-primary" role="img" aria-label={m.store_editor_unsaved()}>
      ●
    </span>
  );
}

type NewFileFormProps = Pick<AppFileTreeProps, "onCreate" | "isCreating">;

/**
 * "New file": a button, then a path input; Escape or an empty name puts the button back. A refused path stays in the
 * input, why under it, until it changes.
 */
function NewFileForm({ onCreate, isCreating }: NewFileFormProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [relativePath, setRelativePath] = useState("");
  const [refusal, setRefusal] = useState<string | undefined>(undefined);

  const close = () => {
    setIsEditing(false);
    setRelativePath("");
    setRefusal(undefined);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // An Enter while the create runs would send a second one: `readOnly` stops the typing, not the submit.
    if (isCreating) {
      return;
    }

    const trimmed = relativePath.trim();

    if (trimmed.length === 0) {
      close();

      return;
    }

    const refused = await onCreate(trimmed);

    if (refused === undefined) {
      close();
    } else {
      setRefusal(refused);
    }
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
        {m.store_editor_new_file()}
      </Button>
    );
  }

  return (
    <form className="flex flex-col gap-1" onSubmit={event => void handleSubmit(event)}>
      <Input
        autoFocus
        aria-label={m.store_editor_new_file_path()}
        aria-invalid={refusal !== undefined}
        aria-describedby={refusal === undefined ? undefined : "new-file-error"}
        value={relativePath}
        placeholder={m.store_editor_new_file_placeholder()}
        className="font-mono"
        readOnly={isCreating}
        onChange={event => {
          setRelativePath(event.target.value);
          setRefusal(undefined);
        }}
        onKeyDown={event => {
          if (event.key === "Escape") {
            close();
          }
        }}
      />
      {refusal !== undefined && <FieldError id="new-file-error">{refusal}</FieldError>}
    </form>
  );
}
