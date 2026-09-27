import { newId } from "@/lib/ids";
import type { DirectorOutput, ScriptOutput } from "@/lib/ai/contracts";
import {
  LIMITS,
  type Brief,
  type DirectorNote,
  type Hook,
  type Project,
  type ProjectStyle,
  type Scene,
} from "@/lib/project/schema";
import { fitDurations } from "@/lib/project/timeline";

export const DEFAULT_STYLE: ProjectStyle = { captionStyle: "pop", voice: "Puck", transition: "cut" };

export function blankScene(patch: Partial<Scene> = {}): Scene {
  return { id: newId(), durationSec: 3, voiceover: "", caption: "", visual: "", shot: "medium", ...patch };
}

export function createProject(input: {
  brief: Brief;
  title?: string;
  hooks?: Hook[];
  hookId?: string;
  script?: ScriptOutput;
  now?: number;
}): Project {
  const now = input.now ?? Date.now();
  const raw = input.script?.scenes ?? [];
  const durations = fitDurations(raw.map((s) => s.durationSec), input.brief.durationSec);
  const scenes: Scene[] = raw.length
    ? raw.map((s, i) => blankScene({ ...s, durationSec: durations[i] ?? s.durationSec }))
    : [
        blankScene({ caption: "your hook goes here", shot: "text-card" }),
        blankScene({ caption: "show the problem" }),
        blankScene({ caption: "show the payoff" }),
      ];
  return {
    id: newId(),
    version: 1,
    title: (input.title ?? input.script?.title ?? "").trim().slice(0, LIMITS.title) || "Untitled video",
    createdAt: now,
    updatedAt: now,
    brief: input.brief,
    hooks: input.hooks ?? [],
    hookId: input.hookId,
    scenes,
    style: { ...DEFAULT_STYLE },
    notes: [],
  };
}

export function selectedHook(project: Project): Hook | undefined {
  return project.hooks.find((h) => h.id === project.hookId);
}

/** Director notes refer to scenes by number; map them to scene ids and give each note an id. */
export function notesFromDirector(project: Project, output: DirectorOutput): DirectorNote[] {
  return output.notes.map((n) => {
    const scene = n.scene >= 1 ? project.scenes[n.scene - 1] : undefined;
    const needsScene = n.action && n.action.kind !== "hook";
    const action = n.action && (!needsScene || scene) ? { ...n.action, sceneId: scene?.id } : undefined;
    return {
      id: newId(),
      severity: n.severity,
      title: n.title,
      body: n.body,
      sceneId: scene?.id,
      action,
      status: "open" as const,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Reducer                                                             */
/* ------------------------------------------------------------------ */

export type ProjectAction =
  | { type: "replace"; project: Project }
  | { type: "setTitle"; title: string }
  | { type: "setStyle"; patch: Partial<ProjectStyle> }
  | { type: "setHook"; hookId: string }
  | { type: "addHook"; text: string; angle?: string; select?: boolean }
  | { type: "updateScene"; id: string; patch: Partial<Omit<Scene, "id">> }
  | { type: "addScene"; afterId?: string }
  | { type: "duplicateScene"; id: string }
  | { type: "removeScene"; id: string }
  | { type: "moveScene"; id: string; delta: -1 | 1 }
  | { type: "setNotes"; summary: string; notes: DirectorNote[] }
  | { type: "applyNote"; id: string }
  | { type: "dismissNote"; id: string }
  | { type: "setExport"; mime: string; bytes: number; at: number };

function updateSceneIn(scenes: Scene[], id: string, patch: Partial<Omit<Scene, "id">>): Scene[] {
  return scenes.map((s) => (s.id === id ? { ...s, ...patch } : s));
}

function applyNoteTo(project: Project, note: DirectorNote): Project {
  const action = note.action;
  if (!action) return project;
  switch (action.kind) {
    case "caption":
    case "voiceover": {
      if (!action.sceneId || !project.scenes.some((s) => s.id === action.sceneId)) return project;
      const patch =
        action.kind === "caption"
          ? { caption: String(action.value).slice(0, LIMITS.caption) }
          : { voiceover: String(action.value).slice(0, LIMITS.voiceover) };
      return { ...project, scenes: updateSceneIn(project.scenes, action.sceneId, patch) };
    }
    case "duration": {
      if (!action.sceneId || !project.scenes.some((s) => s.id === action.sceneId)) return project;
      const n = Number(action.value);
      if (!Number.isFinite(n)) return project;
      const durationSec = Math.min(LIMITS.sceneMax, Math.max(LIMITS.sceneMin, n));
      return { ...project, scenes: updateSceneIn(project.scenes, action.sceneId, { durationSec }) };
    }
    case "hook": {
      const text = String(action.value).trim().slice(0, LIMITS.hook);
      if (!text) return project;
      const hook: Hook = { id: newId(), text, angle: "Suggested by the AI director." };
      return { ...project, hooks: [...project.hooks, hook], hookId: hook.id };
    }
  }
}

function reduce(project: Project, action: ProjectAction): Project {
  switch (action.type) {
    case "replace":
      return action.project;
    case "setTitle":
      return { ...project, title: action.title.slice(0, LIMITS.title) };
    case "setStyle":
      return { ...project, style: { ...project.style, ...action.patch } };
    case "setHook":
      return project.hooks.some((h) => h.id === action.hookId) ? { ...project, hookId: action.hookId } : project;
    case "addHook": {
      const text = action.text.trim().slice(0, LIMITS.hook);
      if (!text) return project;
      const hook: Hook = { id: newId(), text, angle: action.angle ?? "" };
      return { ...project, hooks: [...project.hooks, hook], hookId: action.select === false ? project.hookId : hook.id };
    }
    case "updateScene":
      return { ...project, scenes: updateSceneIn(project.scenes, action.id, action.patch) };
    case "addScene": {
      if (project.scenes.length >= LIMITS.maxScenes) return project;
      const scenes = [...project.scenes];
      const at = action.afterId ? scenes.findIndex((s) => s.id === action.afterId) + 1 : scenes.length;
      scenes.splice(at <= 0 ? scenes.length : at, 0, blankScene());
      return { ...project, scenes };
    }
    case "duplicateScene": {
      if (project.scenes.length >= LIMITS.maxScenes) return project;
      const i = project.scenes.findIndex((s) => s.id === action.id);
      if (i < 0) return project;
      const scenes = [...project.scenes];
      scenes.splice(i + 1, 0, { ...scenes[i]!, id: newId() });
      return { ...project, scenes };
    }
    case "removeScene": {
      if (project.scenes.length <= 1) return project;
      return {
        ...project,
        scenes: project.scenes.filter((s) => s.id !== action.id),
        notes: project.notes.filter((n) => n.sceneId !== action.id),
      };
    }
    case "moveScene": {
      const i = project.scenes.findIndex((s) => s.id === action.id);
      const j = i + action.delta;
      if (i < 0 || j < 0 || j >= project.scenes.length) return project;
      const scenes = [...project.scenes];
      [scenes[i], scenes[j]] = [scenes[j]!, scenes[i]!];
      return { ...project, scenes };
    }
    case "setNotes":
      return { ...project, notes: action.notes, directorSummary: action.summary };
    case "applyNote": {
      const note = project.notes.find((n) => n.id === action.id);
      if (!note || note.status !== "open") return project;
      const applied = applyNoteTo(project, note);
      return { ...applied, notes: applied.notes.map((n) => (n.id === note.id ? { ...n, status: "applied" as const } : n)) };
    }
    case "dismissNote":
      return { ...project, notes: project.notes.map((n) => (n.id === action.id ? { ...n, status: "dismissed" as const } : n)) };
    case "setExport":
      return { ...project, lastExport: { mime: action.mime, bytes: action.bytes, at: action.at } };
  }
}

/** Apply an action and stamp updatedAt when anything changed. */
export function projectReducer(project: Project, action: ProjectAction): Project {
  const next = reduce(project, action);
  if (next === project || action.type === "replace") return next;
  return { ...next, updatedAt: Date.now() };
}
