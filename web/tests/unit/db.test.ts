import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createProject } from "@/lib/project/ops";
import type { Brief } from "@/lib/project/schema";
import { deleteProject, getProject, listProjects, saveProject } from "@/lib/storage/db";

const brief: Brief = { idea: "A day running a pottery studio", durationSec: 45, tone: "calm", voiceover: false };

describe("project storage", () => {
  it("saves, lists newest first, reads and deletes", async () => {
    const a = createProject({ brief, title: "A", now: 1 });
    const b = createProject({ brief, title: "B", now: 2 });
    await saveProject(a);
    await saveProject(b);
    const list = await listProjects();
    expect(list.map((p) => p.title).slice(0, 2)).toEqual(["B", "A"]);
    expect((await getProject(a.id))?.title).toBe("A");
    await deleteProject(a.id);
    expect(await getProject(a.id)).toBeNull();
  });

  it("skips corrupted records instead of failing the whole list", async () => {
    const good = createProject({ brief, title: "Good", now: 10 });
    await saveProject(good);
    await saveProject({ ...good, id: "broken", version: 2 } as unknown as typeof good);
    const list = await listProjects();
    expect(list.some((p) => p.id === "broken")).toBe(false);
    expect(list.some((p) => p.id === good.id)).toBe(true);
    expect(await getProject("broken")).toBeNull();
  });
});
