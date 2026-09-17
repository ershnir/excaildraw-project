import "fake-indexeddb/auto";

import { PagesManager } from "../data/pages";

import type { ExcalidrawElement } from "@excalidraw/element/types";

const fakeElement = (id: string) =>
  ({ id, type: "rectangle" } as unknown as ExcalidrawElement);

describe("PagesManager", () => {
  beforeEach(async () => {
    await PagesManager._debugClearAll();
  });

  it("migrates an existing scene into a single 'Page 1' on first run", async () => {
    const { index, migrated } = await PagesManager.init(() => ({
      elements: [fakeElement("a")],
      appState: {},
    }));

    expect(migrated).toBe(true);
    expect(index.pages).toHaveLength(1);
    expect(index.pages[0].name).toBe("Page 1");
    expect(index.activePageId).toBe(index.pages[0].id);

    const scene = await PagesManager.loadPageScene(index.activePageId);
    expect(scene.elements).toHaveLength(1);
  });

  it("does not re-migrate on a second init() call", async () => {
    const first = await PagesManager.init(() => ({
      elements: [fakeElement("a")],
      appState: {},
    }));
    const second = await PagesManager.init(() => ({
      elements: [fakeElement("should-not-be-used")],
      appState: {},
    }));

    expect(second.migrated).toBe(false);
    expect(second.index.pages[0].id).toBe(first.index.pages[0].id);
  });

  it("keeps each page's elements isolated when switching (Test 1 from spec)", async () => {
    const { index: idx1 } = await PagesManager.init(() => ({
      elements: [fakeElement("rect-1")],
      appState: {},
    }));
    const page1Id = idx1.activePageId;

    const { page: page2 } = await PagesManager.addPage();
    await PagesManager.saveSceneNow(page2.id, [fakeElement("circle-1")], {});

    const page1Scene = await PagesManager.loadPageScene(page1Id);
    const page2Scene = await PagesManager.loadPageScene(page2.id);

    expect(page1Scene.elements.map((e) => e.id)).toEqual(["rect-1"]);
    expect(page2Scene.elements.map((e) => e.id)).toEqual(["circle-1"]);
  });

  it("persists a rename", async () => {
    const { index } = await PagesManager.init(() => ({
      elements: [],
      appState: {},
    }));
    const id = index.pages[0].id;

    const renamed = await PagesManager.renamePage(id, "Architecture");
    expect(renamed.pages[0].name).toBe("Architecture");

    // ignores empty/whitespace-only names rather than clobbering the title
    const unchanged = await PagesManager.renamePage(id, "   ");
    expect(unchanged.pages[0].name).toBe("Architecture");
  });

  it("deletes a non-active page without touching the active one", async () => {
    const { index: idx1 } = await PagesManager.init(() => ({
      elements: [fakeElement("keep-me")],
      appState: {},
    }));
    const page1Id = idx1.activePageId;
    const { page: page2 } = await PagesManager.addPage();

    // switch back to page 1 conceptually (addPage() sets page2 active)
    await PagesManager.setActivePageId(page1Id);

    const afterDelete = await PagesManager.deletePage(page2.id);
    expect(afterDelete.pages).toHaveLength(1);
    expect(afterDelete.activePageId).toBe(page1Id);

    const page1Scene = await PagesManager.loadPageScene(page1Id);
    expect(page1Scene.elements.map((e) => e.id)).toEqual(["keep-me"]);
  });

  it("refuses to delete the last remaining page", async () => {
    const { index } = await PagesManager.init(() => ({
      elements: [],
      appState: {},
    }));
    const onlyPageId = index.pages[0].id;

    const result = await PagesManager.deletePage(onlyPageId);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].id).toBe(onlyPageId);
  });

  it("re-points activePageId at a remaining page when the active page is deleted", async () => {
    const { index: idx1 } = await PagesManager.init(() => ({
      elements: [],
      appState: {},
    }));
    const page1Id = idx1.activePageId;
    const { index: idx2 } = await PagesManager.addPage();
    expect(idx2.activePageId).not.toBe(page1Id);

    const afterDelete = await PagesManager.deletePage(idx2.activePageId);
    expect(afterDelete.pages).toHaveLength(1);
    expect(afterDelete.activePageId).toBe(page1Id);
  });

  it("duplicates a page with independently-editable content", async () => {
    const { index } = await PagesManager.init(() => ({
      elements: [fakeElement("orig")],
      appState: {},
    }));
    const originalId = index.activePageId;

    const { page: copy } = await PagesManager.duplicatePage(originalId);
    expect(copy.name).toBe("Page 1 Copy");

    // mutate the duplicate only
    await PagesManager.saveSceneNow(
      copy.id,
      [fakeElement("orig"), fakeElement("added-to-copy")],
      {},
    );

    const originalScene = await PagesManager.loadPageScene(originalId);
    const copyScene = await PagesManager.loadPageScene(copy.id);

    expect(originalScene.elements).toHaveLength(1);
    expect(copyScene.elements).toHaveLength(2);
  });
});
