"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import type { Asset } from "@/lib/editor/assets";
import type { Engine } from "@/lib/editor/engine";
import type { EditorLevel } from "@/lib/editor/features";
import type { Edit, Selection } from "@/lib/editor/model";
import type { EditActions } from "./use-edit";

/* What every part of the editor shares: the edit, the selection, the files and the preview's engine. */

export type EditorContextValue = {
  edit: Edit;
  /** The edit as it is now: for work that finishes later (a reversed clip, captions), which mustn’t undo what was changed meanwhile. */
  current: () => Edit;
  selection: Selection;
  change: EditActions["change"];
  select: EditActions["select"];
  engine: Engine;
  /** The edit's files that are open (see `missing` for those that aren't). */
  assets: ReadonlyMap<string, Asset>;
  /** Files the edit uses that this browser no longer has: they have to be added again. */
  missing: ReadonlySet<string>;
  /**
   * Open files and put them in the edit: videos and photos on the main track, sounds at the
   * playhead (or `at`). `volume`: how loud the sounds start (a voiceover is the voice, not
   * background music). `select`: select the first sound added.
   */
  addFiles: (files: File[], options?: { at?: number; volume?: number; select?: boolean }) => Promise<void>;
  /** Open files and keep them with the edit without putting them anywhere: the caller places them (a reversed clip, a layer). */
  openFiles: (files: File[]) => Promise<Asset[]>;
  /** Open the file picker. `accept`: what it offers. `replace`: the id of a missing file to bring back. */
  pickFiles: (options?: { accept?: string; replace?: string }) => void;
  /** Counts up as thumbnails and waveforms arrive, so the timeline redraws them. */
  drawn: number;
  /** The account's plan, for the features that need one (lib/editor/features.ts: ask with `can`). */
  level: EditorLevel;
};

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const value = useContext(EditorContext);
  if (!value) throw new Error("useEditor needs the editor around it");
  return value;
}

/** Whether the preview is playing. */
export function usePlaying(engine: Engine): boolean {
  return useSyncExternalStore(
    (listener) => engine.subscribe(listener),
    () => engine.playing,
    () => false,
  );
}

export const ACCEPT_ALL = "video/*,image/*,audio/*,.mkv,.mov";
export const ACCEPT_SOUND = "audio/*,.mp3,.m4a,.wav,.ogg,.flac";
