"use client";

import { useCallback, useReducer } from "react";
import type { Edit, Selection } from "@/lib/editor/model";

/*
 * The edit being worked on, what's selected, and its history. Every change is a whole new edit
 * (see lib/editor/timeline.ts), so undo and redo are stacks of edits. Changes that come in a
 * stream (dragging an edge, a slider) carry a `key`: while the key repeats within a second
 * they're one step of history, not a hundred.
 */

type State = { edit: Edit; selection: Selection; past: Edit[]; future: Edit[]; key: string | null; at: number };
type Action =
  | { type: "load"; edit: Edit }
  | { type: "change"; edit: Edit; selection?: Selection; key?: string; now: number }
  | { type: "select"; selection: Selection }
  | { type: "undo" }
  | { type: "redo" };

const HISTORY = 100;

/** Whatever was selected, if it's still in the edit. */
function keep(edit: Edit, selection: Selection): Selection {
  if (!selection) return null;
  const list = selection.kind === "clip" ? edit.clips : selection.kind === "text" ? edit.texts : edit.audio;
  return list.some((item) => item.id === selection.id) ? selection : null;
}

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "load":
      return { edit: action.edit, selection: null, past: [], future: [], key: null, at: 0 };
    case "select":
      return { ...state, selection: action.selection, key: null };
    case "change": {
      const selection = keep(action.edit, action.selection === undefined ? state.selection : action.selection);
      if (action.edit === state.edit) return { ...state, selection };
      const joined = action.key !== undefined && action.key === state.key && action.now - state.at < 1000;
      return {
        edit: action.edit,
        selection,
        past: joined ? state.past : [...state.past, state.edit].slice(-HISTORY),
        future: [],
        key: action.key ?? null,
        at: action.now,
      };
    }
    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return { edit: previous, selection: keep(previous, state.selection), past: state.past.slice(0, -1), future: [state.edit, ...state.future], key: null, at: 0 };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return { edit: next, selection: keep(next, state.selection), past: [...state.past, state.edit], future: state.future.slice(1), key: null, at: 0 };
    }
  }
}

export type EditActions = {
  /** Replace the edit (a step of history). `key`: join a stream of changes into one step. */
  change: (edit: Edit, options?: { selection?: Selection; key?: string }) => void;
  select: (selection: Selection) => void;
  undo: () => void;
  redo: () => void;
  load: (edit: Edit) => void;
};

export function useEdit(initial: Edit): { edit: Edit; selection: Selection; canUndo: boolean; canRedo: boolean } & EditActions {
  const [state, dispatch] = useReducer(reduce, { edit: initial, selection: null, past: [], future: [], key: null, at: 0 });
  const change = useCallback<EditActions["change"]>((edit, options) => dispatch({ type: "change", edit, selection: options?.selection, key: options?.key, now: Date.now() }), []);
  const select = useCallback<EditActions["select"]>((selection) => dispatch({ type: "select", selection }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const load = useCallback((edit: Edit) => dispatch({ type: "load", edit }), []);
  return { edit: state.edit, selection: state.selection, canUndo: state.past.length > 0, canRedo: state.future.length > 0, change, select, undo, redo, load };
}
