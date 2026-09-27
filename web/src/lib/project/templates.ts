import type { Duration, Tone } from "@/lib/project/schema";

export type Template = {
  id: string;
  label: string;
  /** Told to the AI so the script follows the format. */
  structure: string;
  /** Shown as the prompt placeholder. */
  example: string;
  durationSec: Duration;
  tone: Tone;
};

export const TEMPLATES: readonly Template[] = [
  {
    id: "product-launch",
    label: "Product launch",
    structure: "Show the product in use first, then the problem it solves, 2 or 3 key benefits, and where to get it.",
    example: "Our new cold brew concentrate, for people who hate mornings",
    durationSec: 30,
    tone: "bold",
  },
  {
    id: "quick-tips",
    label: "Quick tips",
    structure: "Promise a number of tips up front, then one tip per scene, strongest tip first.",
    example: "3 ways to keep basil alive on a windowsill",
    durationSec: 30,
    tone: "educational",
  },
  {
    id: "day-in-the-life",
    label: "Day in the life",
    structure: "Quick moments across one day, in order, with one honest detail per scene.",
    example: "A day running a one-person pottery studio",
    durationSec: 45,
    tone: "calm",
  },
  {
    id: "recipe",
    label: "Recipe",
    structure: "Finished dish first, then the ingredients, fast steps, and the first bite.",
    example: "Crispy chili oil eggs in 5 minutes",
    durationSec: 30,
    tone: "funny",
  },
  {
    id: "before-after",
    label: "Before and after",
    structure: "Tease the after first, then the before, the process in fast steps, and the full reveal.",
    example: "Turning a messy balcony into a reading nook",
    durationSec: 30,
    tone: "bold",
  },
  {
    id: "story-time",
    label: "Story time",
    structure: "A short personal story with a setup, a turn and a lesson, told to camera.",
    example: "The worst customer email I ever got, and what it taught me",
    durationSec: 45,
    tone: "heartfelt",
  },
];

export function templateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
