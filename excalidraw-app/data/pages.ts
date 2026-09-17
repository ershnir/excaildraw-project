/**
 * Multi-page / workspace support for the local/self-hosted Excalidraw app.
 *
 * Design notes
 * ------------
 * - Each Page owns its own `elements` + a persisted subset of `appState`.
 *   Binary files (images) are intentionally NOT duplicated per page: they
 *   continue to live in the single shared `files-db` store that
 *   `LocalData.fileStorage` already manages (keyed by `fileId`), exactly like
 *   upstream Excalidraw does for the single-scene case. This avoids
 *   duplicating potentially large binary blobs across pages and matches
 *   "don't build new architecture where the existing one already works".
 * - Everything is stored in IndexedDB (via `idb-keyval`, already a dependency
 *   used by `LocalData.ts`) rather than `localStorage`, since a workspace
 *   with many pages can easily exceed localStorage's ~5MB quota.
 * - The legacy single-scene `localStorage` keys (`STORAGE_KEYS.LOCAL_STORAGE_*`)
 *   are left completely untouched. On first run, whatever scene they held is
 *   migrated once into "Page 1" (see `PagesManager.init`). After that, the
 *   pages store is the source of truth; legacy keys are simply not written to
 *   anymore by the multi-page code path (existing `LocalData.save` calls are
 *   left in place elsewhere for anyone relying on the old keys/back-compat
 *   tooling, but they no longer drive what's shown on the canvas).
 */

import { createStore, get, set, del, keys } from "idb-keyval";

import { debounce, randomId } from "@excalidraw/common";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

export type PageId = string;

export type PageMeta = {
  id: PageId;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type PagesIndex = {
  /** ordered list of pages, in display order */
  pages: PageMeta[];
  activePageId: PageId;
};

/** the subset of scene data we persist per page */
export type PageSceneData = {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
};

const PAGES_IDB_NAME = "excalidraw-pages-db";
const PAGES_STORE_NAME = "excalidraw-pages-store";
const pagesStore = createStore(PAGES_IDB_NAME, PAGES_STORE_NAME);

const INDEX_KEY = "__pages_index__";
const sceneKey = (id: PageId) => `page-scene:${id}`;

export const DEFAULT_PAGE_NAME_PREFIX = "Page";

const emptyScene = (): PageSceneData => ({ elements: [], appState: {} });

class PagesManagerImpl {
  /** in-memory cache of the index so callers can read it synchronously
   * once `init()` has resolved */
  private indexCache: PagesIndex | null = null;

  getCachedIndex(): PagesIndex | null {
    return this.indexCache;
  }

  private async loadIndex(): Promise<PagesIndex | null> {
    const index = (await get<PagesIndex>(INDEX_KEY, pagesStore)) || null;
    if (index) {
      this.indexCache = index;
    }
    return index;
  }

  private async persistIndex(index: PagesIndex) {
    this.indexCache = index;
    await set(INDEX_KEY, index, pagesStore);
  }

  /**
   * Ensures a pages index exists. If this is the very first run (no pages
   * store yet), migrates whatever scene is currently on the canvas
   * (typically loaded from the legacy localStorage keys, or an empty scene)
   * into a single "Page 1".
   *
   * Returns the resulting index.
   */
  async init(
    getFallbackScene: () => PageSceneData,
  ): Promise<{ index: PagesIndex; migrated: boolean }> {
    const existing = await this.loadIndex();
    if (existing && existing.pages.length > 0) {
      return { index: existing, migrated: false };
    }

    const fallback = getFallbackScene();
    const now = Date.now();
    const page: PageMeta = {
      id: randomId(),
      name: `${DEFAULT_PAGE_NAME_PREFIX} 1`,
      createdAt: now,
      updatedAt: now,
    };
    await set(sceneKey(page.id), fallback, pagesStore);

    const index: PagesIndex = { pages: [page], activePageId: page.id };
    await this.persistIndex(index);
    return { index, migrated: true };
  }

  async loadPageScene(id: PageId): Promise<PageSceneData> {
    const data = await get<PageSceneData>(sceneKey(id), pagesStore);
    return data || emptyScene();
  }

  /** debounced per-page scene writer (300ms, mirrors SAVE_TO_LOCAL_STORAGE_TIMEOUT) */
  private _saveScene = debounce(
    async (id: PageId, elements: readonly ExcalidrawElement[], appState: Partial<AppState>) => {
      await set(sceneKey(id), { elements, appState }, pagesStore);
    },
    300,
  );

  saveSceneDebounced = (
    id: PageId,
    elements: readonly ExcalidrawElement[],
    appState: Partial<AppState>,
  ) => {
    this._saveScene(id, elements, appState);
  };

  flushSave = () => {
    this._saveScene.flush();
  };

  /** synchronous (non-debounced) write, used right before switching pages */
  async saveSceneNow(
    id: PageId,
    elements: readonly ExcalidrawElement[],
    appState: Partial<AppState>,
  ) {
    this._saveScene.cancel();
    await set(sceneKey(id), { elements, appState }, pagesStore);
  }

  async addPage(name?: string): Promise<{ index: PagesIndex; page: PageMeta }> {
    const index = this.indexCache;
    if (!index) {
      throw new Error("PagesManager not initialized");
    }
    const now = Date.now();
    const page: PageMeta = {
      id: randomId(),
      name: name?.trim() || `${DEFAULT_PAGE_NAME_PREFIX} ${index.pages.length + 1}`,
      createdAt: now,
      updatedAt: now,
    };
    await set(sceneKey(page.id), emptyScene(), pagesStore);
    const nextIndex: PagesIndex = {
      pages: [...index.pages, page],
      activePageId: page.id,
    };
    await this.persistIndex(nextIndex);
    return { index: nextIndex, page };
  }

  async renamePage(id: PageId, name: string): Promise<PagesIndex> {
    const index = this.indexCache;
    if (!index) {
      throw new Error("PagesManager not initialized");
    }
    const trimmed = name.trim();
    if (!trimmed) {
      return index;
    }
    const nextIndex: PagesIndex = {
      ...index,
      pages: index.pages.map((p) =>
        p.id === id ? { ...p, name: trimmed, updatedAt: Date.now() } : p,
      ),
    };
    await this.persistIndex(nextIndex);
    return nextIndex;
  }

  /**
   * Deletes a page. Refuses to delete the last remaining page (returns the
   * index unchanged in that case — callers should disable the delete action
   * in the UI when `pages.length === 1`).
   *
   * If the active page is deleted, the caller is responsible for switching
   * the canvas to `nextIndex.activePageId` *before* this promise's result is
   * used to re-render, since this function only updates bookkeeping.
   */
  async deletePage(id: PageId): Promise<PagesIndex> {
    const index = this.indexCache;
    if (!index) {
      throw new Error("PagesManager not initialized");
    }
    if (index.pages.length <= 1) {
      // guard: never allow zero pages
      return index;
    }
    const remaining = index.pages.filter((p) => p.id !== id);
    const wasActive = index.activePageId === id;
    const nextActiveId = wasActive ? remaining[0].id : index.activePageId;

    const nextIndex: PagesIndex = {
      pages: remaining,
      activePageId: nextActiveId,
    };
    await this.persistIndex(nextIndex);
    await del(sceneKey(id), pagesStore);
    return nextIndex;
  }

  async duplicatePage(id: PageId): Promise<{ index: PagesIndex; page: PageMeta }> {
    const index = this.indexCache;
    if (!index) {
      throw new Error("PagesManager not initialized");
    }
    const original = index.pages.find((p) => p.id === id);
    if (!original) {
      throw new Error(`Page ${id} not found`);
    }
    const scene = await this.loadPageScene(id);
    const now = Date.now();
    const page: PageMeta = {
      id: randomId(),
      name: `${original.name} Copy`,
      createdAt: now,
      updatedAt: now,
    };
    // deep-ish copy: new page gets its own elements/appState array & object
    // so future edits to the duplicate never mutate the original's persisted
    // data (the original in-memory arrays are only ever read here, never
    // written to).
    await set(
      sceneKey(page.id),
      {
        elements: scene.elements.map((el) => ({ ...el })),
        appState: { ...scene.appState },
      },
      pagesStore,
    );

    const originalIdx = index.pages.findIndex((p) => p.id === id);
    const pages = [...index.pages];
    pages.splice(originalIdx + 1, 0, page);

    const nextIndex: PagesIndex = { ...index, pages };
    await this.persistIndex(nextIndex);
    return { index: nextIndex, page };
  }

  async setActivePageId(id: PageId): Promise<PagesIndex> {
    const index = this.indexCache;
    if (!index) {
      throw new Error("PagesManager not initialized");
    }
    const nextIndex: PagesIndex = { ...index, activePageId: id };
    await this.persistIndex(nextIndex);
    return nextIndex;
  }

  /** exposed for tests */
  async _debugClearAll() {
    const index = await this.loadIndex();
    if (index) {
      await Promise.all(index.pages.map((p) => del(sceneKey(p.id), pagesStore)));
    }
    await del(INDEX_KEY, pagesStore);
    this.indexCache = null;
  }

  async _debugAllKeys() {
    return keys(pagesStore);
  }
}

export const PagesManager = new PagesManagerImpl();
