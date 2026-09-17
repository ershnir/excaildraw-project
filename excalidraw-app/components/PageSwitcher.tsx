import clsx from "clsx";
import React, { useEffect, useRef, useState } from "react";

import {
  PlusIcon,
  TrashIcon,
  DuplicateIcon,
  pencilIcon,
  chevronDownIcon,
  checkIcon,
} from "@excalidraw/excalidraw/components/icons";

import type { PageId, PageMeta } from "../data/pages";

import "./PageSwitcher.scss";

export type PageSwitcherProps = {
  pages: PageMeta[];
  activePageId: PageId | null;
  isMobile: boolean;
  onSwitchPage: (id: PageId) => void;
  onAddPage: () => void;
  onRenamePage: (id: PageId, name: string) => void;
  onDeletePage: (id: PageId) => void;
  onDuplicatePage: (id: PageId) => void;
};

export const PageSwitcher: React.FC<PageSwitcherProps> = ({
  pages,
  activePageId,
  isMobile,
  onSwitchPage,
  onAddPage,
  onRenamePage,
  onDeletePage,
  onDuplicatePage,
}) => {
  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<PageId | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [actionsForId, setActionsForId] = useState<PageId | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const activePage = pages.find((p) => p.id === activePageId) ?? pages[0];

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
        setRenamingId(null);
        setActionsForId(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setRenamingId(null);
        setActionsForId(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const startRename = (page: PageMeta) => {
    setRenamingId(page.id);
    setRenameValue(page.name);
    setActionsForId(null);
  };

  const commitRename = () => {
    if (renamingId) {
      onRenamePage(renamingId, renameValue);
    }
    setRenamingId(null);
  };

  if (!activePage) {
    return null;
  }

  return (
    <div
      className={clsx("page-switcher", { "page-switcher--mobile": isMobile })}
      ref={containerRef}
    >
      <button
        type="button"
        className="page-switcher__trigger"
        onClick={() => setOpen((v) => !v)}
        title="Pages"
        data-testid="page-switcher-trigger"
      >
        <span className="page-switcher__trigger-label">{activePage.name}</span>
        <span className="page-switcher__trigger-icon">{chevronDownIcon}</span>
      </button>

      {open && (
        <div className="page-switcher__menu" role="menu">
          <div className="page-switcher__menu-title">Pages</div>
          <div className="page-switcher__list">
            {pages.map((page) => (
              <div key={page.id} className="page-switcher__row">
                {renamingId === page.id ? (
                  <input
                    autoFocus
                    className="page-switcher__rename-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        commitRename();
                      } else if (e.key === "Escape") {
                        setRenamingId(null);
                      }
                    }}
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      className={clsx("page-switcher__item", {
                        "page-switcher__item--active": page.id === activePageId,
                      })}
                      onClick={() => {
                        onSwitchPage(page.id);
                        setOpen(false);
                      }}
                    >
                      <span className="page-switcher__item-check">
                        {page.id === activePageId ? checkIcon : null}
                      </span>
                      <span className="page-switcher__item-name">
                        {page.name}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="page-switcher__more"
                      title="Page options"
                      onClick={() =>
                        setActionsForId((cur) =>
                          cur === page.id ? null : page.id,
                        )
                      }
                    >
                      ⋯
                    </button>
                  </>
                )}
                {actionsForId === page.id && renamingId !== page.id && (
                  <div className="page-switcher__actions">
                    <button
                      type="button"
                      onClick={() => startRename(page)}
                      title="Rename"
                    >
                      {pencilIcon}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onDuplicatePage(page.id);
                        setActionsForId(null);
                      }}
                      title="Duplicate"
                    >
                      {DuplicateIcon}
                    </button>
                    <button
                      type="button"
                      disabled={pages.length <= 1}
                      onClick={() => {
                        onDeletePage(page.id);
                        setActionsForId(null);
                      }}
                      title={
                        pages.length <= 1
                          ? "Can't delete the only page"
                          : "Delete"
                      }
                    >
                      {TrashIcon}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="page-switcher__separator" />
          <button
            type="button"
            className="page-switcher__add"
            onClick={() => {
              onAddPage();
              setOpen(false);
            }}
          >
            <span className="page-switcher__add-icon">{PlusIcon}</span>
            Add new page
          </button>
        </div>
      )}
    </div>
  );
};
