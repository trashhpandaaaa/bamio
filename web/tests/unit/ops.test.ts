import { describe, expect, it } from "vitest";
import { createProject, notesFromDirector, projectReducer, selectedHook } from "@/lib/project/ops";
import { LIMITS, projectSchema, type Brief, type Project } from "@/lib/project/schema";

const brief: Brief = { idea: "3 ways to keep basil alive", durationSec: 30, tone: "educational", voiceover: true };

const script = {
  title: "Keep basil alive",
  scenes: [
    { durationSec: 20, voiceover: "Your basil keeps dying.", caption: "your basil keeps dying", visual: "A wilted basil plant", shot: "close-up" as const },
    { durationSec: 20, voiceover: "Water from below.", caption: "water from below", visual: "A pot in a saucer", shot: "overhead" as const },
    { durationSec: 20, voiceover: "Pinch the tops.", caption: "pinch the tops", visual: "Fingers pinching basil", shot: "close-up" as const },
  ],
};

function base(): Project {
  const hooks = [{ id: "h1", text: "Your basil is dying for one reason", angle: "Problem first" }];
  return createProject({ brief, script, hooks, hookId: "h1", now: 1000 });
}

describe("createProject", () => {
  it("builds a valid project and fits scene lengths to the brief", () => {
    const p = base();
    expect(projectSchema.safeParse(p).success).toBe(true);
    const total = p.scenes.reduce((a, s) => a + s.durationSec, 0);
    expect(total).toBeCloseTo(30, 0);
    expect(p.title).toBe("Keep basil alive");
    expect(selectedHook(p)?.text).toContain("basil");
  });

  it("starts with editable blank scenes when there is no script", () => {
    const p = createProject({ brief });
    expect(p.scenes).toHaveLength(3);
    expect(p.title).toBe("Untitled video");
    expect(projectSchema.safeParse(p).success).toBe(true);
  });
});

describe("projectReducer scenes", () => {
  it("adds, duplicates, moves and removes scenes", () => {
    let p = base();
    const [a, b] = p.scenes;
    p = projectReducer(p, { type: "addScene", afterId: a!.id });
    expect(p.scenes).toHaveLength(4);
    expect(p.scenes[0]!.id).toBe(a!.id);
    p = projectReducer(p, { type: "duplicateScene", id: b!.id });
    expect(p.scenes).toHaveLength(5);
    p = projectReducer(p, { type: "moveScene", id: a!.id, delta: 1 });
    expect(p.scenes[1]!.id).toBe(a!.id);
    p = projectReducer(p, { type: "removeScene", id: a!.id });
    expect(p.scenes.find((s) => s.id === a!.id)).toBeUndefined();
  });

  it("refuses impossible moves and removing the last scene", () => {
    let p = base();
    const first = p.scenes[0]!;
    expect(projectReducer(p, { type: "moveScene", id: first.id, delta: -1 })).toBe(p);
    p = { ...p, scenes: [first] };
    expect(projectReducer(p, { type: "removeScene", id: first.id })).toBe(p);
  });

  it("caps the number of scenes", () => {
    let p = base();
    for (let i = 0; i < 20; i++) p = projectReducer(p, { type: "addScene" });
    expect(p.scenes).toHaveLength(LIMITS.maxScenes);
  });

  it("stamps updatedAt only when something changed", () => {
    const p = base();
    expect(projectReducer(p, { type: "setHook", hookId: "missing" })).toBe(p);
    const q = projectReducer(p, { type: "setTitle", title: "New" });
    expect(q.updatedAt).toBeGreaterThan(p.updatedAt);
  });
});

describe("director notes", () => {
  it("maps scene numbers to ids and drops actions that point nowhere", () => {
    const p = base();
    const notes = notesFromDirector(p, {
      summary: "ok",
      notes: [
        { severity: "fix", title: "Caption", body: "", scene: 1, action: { kind: "caption", value: "short" } },
        { severity: "improve", title: "Ghost", body: "", scene: 9, action: { kind: "caption", value: "x" } },
        { severity: "polish", title: "Hook", body: "", scene: 0, action: { kind: "hook", value: "Better hook" } },
      ],
    });
    expect(notes[0]!.action?.sceneId).toBe(p.scenes[0]!.id);
    expect(notes[1]!.action).toBeUndefined();
    expect(notes[2]!.action?.kind).toBe("hook");
  });

  it("applies caption, duration and hook notes once, and dismisses", () => {
    let p = base();
    const s1 = p.scenes[0]!;
    const notes = notesFromDirector(p, {
      summary: "s",
      notes: [
        { severity: "fix", title: "a", body: "", scene: 1, action: { kind: "caption", value: "new caption" } },
        { severity: "fix", title: "b", body: "", scene: 1, action: { kind: "duration", value: 2.5 } },
        { severity: "fix", title: "c", body: "", scene: 1, action: { kind: "hook", value: "A sharper hook" } },
        { severity: "polish", title: "d", body: "", scene: 0, action: null },
      ],
    });
    p = projectReducer(p, { type: "setNotes", summary: "s", notes });
    for (const n of notes.slice(0, 3)) p = projectReducer(p, { type: "applyNote", id: n.id });
    const scene = p.scenes.find((s) => s.id === s1.id)!;
    expect(scene.caption).toBe("new caption");
    expect(scene.durationSec).toBe(2.5);
    expect(selectedHook(p)?.text).toBe("A sharper hook");
    expect(p.notes.slice(0, 3).every((n) => n.status === "applied")).toBe(true);

    // Applying twice does nothing.
    const again = projectReducer(p, { type: "applyNote", id: notes[0]!.id });
    expect(again).toBe(p);

    p = projectReducer(p, { type: "dismissNote", id: notes[3]!.id });
    expect(p.notes[3]!.status).toBe("dismissed");
    expect(projectSchema.safeParse(p).success).toBe(true);
  });

  it("removes notes about a deleted scene", () => {
    let p = base();
    const notes = notesFromDirector(p, { summary: "", notes: [{ severity: "fix", title: "t", body: "", scene: 2, action: null }] });
    p = projectReducer(p, { type: "setNotes", summary: "", notes });
    p = projectReducer(p, { type: "removeScene", id: p.scenes[1]!.id });
    expect(p.notes).toHaveLength(0);
  });
});
