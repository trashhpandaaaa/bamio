import "server-only";
import type { DirectorRequest, ImageRequest, ScriptRequest, VoiceRequest } from "@/lib/ai/contracts";
import type { Brief, Tone } from "@/lib/project/schema";
import { SEVERITIES, SHOTS } from "@/lib/project/schema";
import { templateById } from "@/lib/project/templates";

const HOUSE_STYLE = `House style:
- Plain, specific, spoken English. Second person where natural.
- No emojis, no hashtags, no em dashes, no exclamation marks.
- Never use: unleash, elevate, seamless, game-changer, revolutionize, delve, next-level.
- Never invent statistics, prices or claims the idea does not contain.`;

const TONE_GUIDE: Record<Tone, string> = {
  funny: "playful, quick, with one clean joke rather than many",
  bold: "confident, punchy, short sentences",
  calm: "unhurried, warm, clear",
  heartfelt: "honest, personal, human",
  educational: "clear, practical, one idea per line",
};

export function describeBrief(brief: Brief) {
  const template = brief.templateId ? templateById(brief.templateId) : undefined;
  return [
    `Idea: ${brief.idea}`,
    template ? `Format: ${template.label}. ${template.structure}` : null,
    `Length: ${brief.durationSec} seconds, vertical 9:16.`,
    `Tone: ${brief.tone} (${TONE_GUIDE[brief.tone]}).`,
    brief.audience ? `Audience: ${brief.audience}` : null,
    brief.voiceover ? "It has a spoken voice-over." : "It has no voice-over. On-screen captions carry the story.",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ------------------------------ Hooks ------------------------------ */

export const HOOKS_SYSTEM = `You are Bamio, a creative director for short-form vertical video (TikTok, Reels, Shorts).
Short-form is won in the first second. You write hooks: the opening line that stops the scroll.
${HOUSE_STYLE}`;

export function hooksPrompt(brief: Brief) {
  return `${describeBrief(brief)}

Write 3 different hooks for this video.
- Each hook is at most 12 words and can be said in under 3 seconds.
- Use 3 different angles, for example: a curiosity gap, a bold claim the video proves, a relatable problem, a surprising result shown first.
- "angle" explains in at most 20 words why the hook works.`;
}

export const HOOKS_SCHEMA = {
  type: "object",
  properties: {
    hooks: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          text: { type: "string", description: "The hook line, 12 words or fewer." },
          angle: { type: "string", description: "Why it works, 20 words or fewer." },
        },
        required: ["text", "angle"],
      },
    },
  },
  required: ["hooks"],
} as const;

/* ------------------------------ Script ----------------------------- */

export const SCRIPT_SYSTEM = `You are Bamio, a creative director who turns an idea and a hook into a shot-by-shot short-form video script.
You write for a vertical 9:16 video that is watched with the sound off as often as on.
${HOUSE_STYLE}`;

export function scriptPrompt({ brief, hook }: ScriptRequest) {
  const words = Math.round(brief.durationSec * 2.4);
  return `${describeBrief(brief)}
Hook (scene 1 must open with it): "${hook}"

Write the script as 4 to 8 scenes.
- Scene durations are in seconds and must add up to ${brief.durationSec}, give or take 10%. Early scenes are short (1.5 to 3 s) to keep momentum.
- ${brief.voiceover ? `voiceover: what is spoken in that scene. About ${words} words in total, at most 2.6 words per second of the scene.` : 'voiceover: always an empty string "".'}
- caption: the on-screen text, at most 7 words, punchy, can be lowercase. Scene 1's caption is the hook or its sharpest part.
- visual: a concrete, photographable description of the shot for an image generator: subject, setting, action, light. No text, logos or captions in the image.
- shot: one of ${SHOTS.join(", ")}. Use "text-card" only for a scene that is just bold text on a plain background.
- End with a clear payoff and a simple call to action.
- title: a short working title for the project, at most 6 words.`;
}

export const SCRIPT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    scenes: {
      type: "array",
      minItems: 3,
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          durationSec: { type: "number" },
          voiceover: { type: "string" },
          caption: { type: "string" },
          visual: { type: "string" },
          shot: { type: "string", enum: [...SHOTS] },
        },
        required: ["durationSec", "voiceover", "caption", "visual", "shot"],
      },
    },
  },
  required: ["title", "scenes"],
} as const;

/* ----------------------------- Director ---------------------------- */

export const DIRECTOR_SYSTEM = `You are Bamio's AI director. You review a short-form vertical video script like a sharp, kind creative director and give specific notes the creator can apply in one click.
Judge: the first 2 seconds (does the hook land?), pacing (scene length vs spoken words; about 2.6 words per second is the limit), caption length (7 words max), clarity, and whether it ends with a payoff and a call to action.
${HOUSE_STYLE}`;

export function directorPrompt({ brief, hook, scenes }: DirectorRequest) {
  const lines = scenes
    .map(
      (s, i) =>
        `Scene ${i + 1} (${s.durationSec.toFixed(1)} s, ${s.shot}${s.hasImage ? ", has image" : ", no image yet"})
  voiceover: ${s.voiceover || "(none)"}
  caption: ${s.caption || "(none)"}
  visual: ${s.visual || "(none)"}`,
    )
    .join("\n");
  return `${describeBrief(brief)}
Hook: "${hook || "(none)"}"

${lines}

Give 3 to 6 notes, most important first.
- severity: "fix" (hurts the video), "improve" (clear upgrade) or "polish" (nice to have).
- scene: the 1-based scene number the note is about, or 0 for the whole video.
- action: a concrete edit. Use kind "none" with an empty value if the note is advice only.
  - kind "caption" or "voiceover": value is the full replacement text for that scene.
  - kind "duration": value is the new duration in seconds for that scene, for example "2.5".
  - kind "hook": value is a better hook line (scene must be 1).
- summary: one sentence on the overall state of the video.`;
}

export const DIRECTOR_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    notes: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: [...SEVERITIES] },
          title: { type: "string" },
          body: { type: "string" },
          scene: { type: "integer" },
          action: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["none", "caption", "voiceover", "duration", "hook"] },
              value: { type: "string", description: "Replacement text, or seconds as a number for duration. Empty for none." },
            },
            required: ["kind", "value"],
          },
        },
        required: ["severity", "title", "body", "scene", "action"],
      },
    },
  },
  required: ["summary", "notes"],
} as const;

/* ------------------------------ Media ------------------------------ */

const SHOT_WORDS: Record<(typeof SHOTS)[number], string> = {
  "close-up": "close-up shot",
  medium: "medium shot",
  wide: "wide establishing shot",
  overhead: "overhead top-down shot",
  pov: "first-person point-of-view shot",
  "text-card": "clean minimal background with plenty of empty space",
};

export function imagePrompt({ visual, shot, tone }: ImageRequest) {
  return `A vertical 9:16 photograph for a short-form social video. ${SHOT_WORDS[shot]}: ${visual}
Style: realistic, natural light, shot on a modern phone, ${tone === "calm" || tone === "heartfelt" ? "soft and warm" : "crisp and vivid"}.
Important: no text, letters, captions, logos, watermarks or borders anywhere in the image.`;
}

const VOICE_STYLE: Record<Tone, string> = {
  funny: "with playful, upbeat energy",
  bold: "with confident, punchy energy",
  calm: "calmly and warmly",
  heartfelt: "warmly and sincerely",
  educational: "clearly, like a friendly teacher",
};

export function voicePrompt({ text, tone }: VoiceRequest) {
  return `Read this line for a short social video, ${VOICE_STYLE[tone]}, at a brisk natural pace: ${text}`;
}
