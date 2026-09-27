import { voiceRequestSchema, type VoiceResponse } from "@/lib/ai/contracts";
import { toWav } from "@/lib/audio/wav";
import { AiError, generateSpeech, isMock } from "@/lib/ai/server/gemini";
import { mockVoice } from "@/lib/ai/server/mock";
import { voicePrompt } from "@/lib/ai/server/prompts";
import { aiRoute } from "@/lib/ai/server/route";

export const maxDuration = 120;

export const POST = aiRoute(voiceRequestSchema, async (input, signal): Promise<VoiceResponse> => {
  const audio = isMock() ? mockVoice(input) : await generateSpeech(voicePrompt(input), input.voice, signal);
  const { wav, durationSec } = toWav(new Uint8Array(Buffer.from(audio.data, "base64")), audio.mimeType);
  if (durationSec <= 0) throw new AiError("bad_output", "Gemini returned empty audio. Try again.", 502);
  return { mimeType: "audio/wav", data: Buffer.from(wav).toString("base64"), durationSec };
});
