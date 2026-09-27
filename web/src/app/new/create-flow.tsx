"use client";

import { ArrowClockwise, ArrowLeft, ArrowRight, CaretDown, PencilSimple, WarningCircle } from "@phosphor-icons/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { AiMark } from "@/components/brand";
import { useAiStatus } from "@/hooks/use-ai-status";
import { aiClient, errorMessage, isAbort } from "@/lib/ai/client";
import { createProject, DEFAULT_STYLE } from "@/lib/project/ops";
import { briefSchema, DURATIONS, LIMITS, TONES, VOICES, type Brief, type Duration, type Hook, type Tone } from "@/lib/project/schema";
import { TEMPLATES, templateById } from "@/lib/project/templates";
import { saveProject } from "@/lib/storage/db";
import styles from "./create.module.css";

const TONE_LABEL: Record<Tone, string> = { funny: "Funny", bold: "Bold", calm: "Calm", heartfelt: "Heartfelt", educational: "Educational" };

export function CreateFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const { status } = useAiStatus();
  const aiReady = status?.configured ?? true;
  const initialTemplate = templateById(params.get("template") ?? "");

  const [templateId, setTemplateId] = useState<string | undefined>(initialTemplate?.id);
  const [idea, setIdea] = useState("");
  const [durationSec, setDuration] = useState<Duration>(initialTemplate?.durationSec ?? 30);
  const [tone, setTone] = useState<Tone>(initialTemplate?.tone ?? "bold");
  const [voiceover, setVoiceover] = useState(true);
  const [voice, setVoice] = useState<string>(DEFAULT_STYLE.voice);
  const [audience, setAudience] = useState("");
  const [ideaError, setIdeaError] = useState<string | null>(null);

  const [step, setStep] = useState<"brief" | "hooks">("brief");
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [choice, setChoice] = useState<string>("");
  const [customHook, setCustomHook] = useState("");
  const [busy, setBusy] = useState<"hooks" | "script" | "blank" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const ideaRef = useRef<HTMLTextAreaElement>(null);
  const ids = { idea: useId(), ideaErr: useId(), audience: useId(), voice: useId(), custom: useId() };

  useEffect(() => () => controller.current?.abort(), []);

  const template = templateId ? templateById(templateId) : undefined;

  function buildBrief(): Brief | null {
    const parsed = briefSchema.safeParse({
      idea,
      templateId,
      durationSec,
      tone,
      voiceover,
      audience: audience.trim() || undefined,
    });
    if (!parsed.success) {
      setIdeaError(parsed.error.issues.find((i) => i.path[0] === "idea")?.message ?? "Check the details and try again.");
      ideaRef.current?.focus();
      return null;
    }
    setIdeaError(null);
    return parsed.data;
  }

  function pickTemplate(id: string) {
    if (templateId === id) return setTemplateId(undefined);
    const t = templateById(id);
    if (!t) return;
    setTemplateId(id);
    setDuration(t.durationSec);
    setTone(t.tone);
  }

  async function findHooks() {
    const brief = buildBrief();
    if (!brief) return;
    controller.current?.abort();
    controller.current = new AbortController();
    setBusy("hooks");
    setError(null);
    try {
      const res = await aiClient.hooks({ brief }, controller.current.signal);
      setHooks(res.hooks);
      setChoice(res.hooks[0]?.id ?? "custom");
      setStep("hooks");
    } catch (err) {
      if (!isAbort(err)) setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function writeScript() {
    const brief = buildBrief();
    if (!brief) return setStep("brief");
    const hookText = choice === "custom" ? customHook.trim() : hooks.find((h) => h.id === choice)?.text ?? "";
    if (!hookText) return setError("Write a hook, or pick one of the suggestions.");
    controller.current?.abort();
    controller.current = new AbortController();
    setBusy("script");
    setError(null);
    try {
      const script = await aiClient.script({ brief, hook: hookText }, controller.current.signal);
      const allHooks = choice === "custom" ? [...hooks, { id: "custom", text: hookText, angle: "Written by you." }] : hooks;
      const project = createProject({ brief, script, hooks: allHooks, hookId: choice === "custom" ? "custom" : choice });
      project.style = { ...project.style, voice: voice as typeof project.style.voice };
      await saveProject(project);
      router.push(`/projects/${project.id}`);
    } catch (err) {
      if (!isAbort(err)) setError(errorMessage(err));
      setBusy(null);
    }
  }

  async function startBlank() {
    const brief = buildBrief();
    if (!brief) return;
    setBusy("blank");
    try {
      const project = createProject({ brief });
      project.style = { ...project.style, voice: voice as typeof project.style.voice };
      await saveProject(project);
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  if (step === "hooks") {
    return (
      <div className={`container ${styles.page}`}>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => setStep("brief")} disabled={busy !== null}>
          <ArrowLeft size={16} aria-hidden />
          Back to the idea
        </button>
        <div className={styles.head}>
          <h1 className="t-heading-xl">Pick a hook</h1>
          <p className="t-body-lg t-secondary">The first second decides if people stay. Pick the opening that would stop you, or write your own.</p>
        </div>

        <fieldset className={styles.hooks} disabled={busy !== null}>
          <legend className="sr-only">Hooks</legend>
          {hooks.map((h) => (
            <label key={h.id} className={styles.hook} data-selected={choice === h.id}>
              <input className="radio" type="radio" name="hook" value={h.id} checked={choice === h.id} onChange={() => setChoice(h.id)} />
              <span className={styles.hookText}>
                <strong>{h.text}</strong>
                {h.angle ? (
                  <span className={styles.hookAngle}>
                    <AiMark size={13} /> {h.angle}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
          <label className={styles.hook} data-selected={choice === "custom"}>
            <input className="radio" type="radio" name="hook" value="custom" checked={choice === "custom"} onChange={() => setChoice("custom")} />
            <span className={styles.hookText}>
              <strong>Write your own</strong>
              <input
                id={ids.custom}
                className="input"
                type="text"
                name="custom-hook"
                autoComplete="off"
                maxLength={LIMITS.hook}
                placeholder="Nobody tells you this about…"
                value={customHook}
                aria-label="Your hook"
                onFocus={() => setChoice("custom")}
                onChange={(e) => setCustomHook(e.target.value)}
              />
            </span>
          </label>
        </fieldset>

        {error ? <ErrorNotice message={error} /> : null}

        <div className={styles.actions}>
          <button className="btn btn-secondary" type="button" onClick={() => void findHooks()} disabled={busy !== null} aria-busy={busy === "hooks"}>
            {busy === "hooks" ? null : <ArrowClockwise size={18} aria-hidden />}
            {busy === "hooks" ? "Writing new hooks…" : "New hooks"}
          </button>
          <button className="btn btn-volt btn-lg" type="button" onClick={() => void writeScript()} disabled={busy !== null} aria-busy={busy === "script"}>
            {busy === "script" ? "Writing the script…" : "Write the script"}
            {busy === "script" ? null : <ArrowRight size={18} weight="bold" aria-hidden />}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`container ${styles.page}`}>
      <div className={styles.head}>
        <h1 className="t-heading-xl">What’s the video about?</h1>
        <p className="t-body-lg t-secondary">One sentence is enough. Bamio writes the hooks, the script and the captions from it.</p>
      </div>

      {!aiReady ? (
        <div className="notice is-warning" role="status">
          <WarningCircle size={20} aria-hidden />
          <p>
            <strong>AI is not connected yet</strong>
            Add your Gemini API key as <code>GEMINI_API_KEY</code> in <code>web/.env.local</code> and restart the server. Until then you can start a video and write it yourself.
          </p>
        </div>
      ) : null}

      <section aria-label="Templates" className={styles.templates}>
        <span className="t-label">Format</span>
        <div className={styles.chipRow} role="group" aria-label="Format">
          {TEMPLATES.map((t) => (
            <button key={t.id} type="button" className="chip" aria-pressed={templateId === t.id} onClick={() => pickTemplate(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        {template ? <p className="t-caption t-tertiary">{template.structure}</p> : null}
      </section>

      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (aiReady) void findHooks();
          else void startBlank();
        }}
        noValidate
      >
        <div className="prompt">
          <label className="sr-only" htmlFor={ids.idea}>
            Describe your video
          </label>
          <textarea
            ref={ideaRef}
            id={ids.idea}
            name="idea"
            autoComplete="off"
            maxLength={LIMITS.idea}
            placeholder={`${template?.example ?? "Our new cold brew, for people who hate mornings"}…`}
            value={idea}
            aria-invalid={ideaError ? true : undefined}
            aria-describedby={ideaError ? ids.ideaErr : undefined}
            onChange={(e) => {
              setIdea(e.target.value);
              if (ideaError) setIdeaError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
            }}
          />
          <div className="prompt-row">
            <span className="t-caption t-tertiary">
              {idea.length}/{LIMITS.idea}
            </span>
          </div>
        </div>
        {ideaError ? (
          <p className="field-error" id={ids.ideaErr}>
            <WarningCircle size={14} aria-hidden />
            {ideaError}
          </p>
        ) : null}

        <div className={styles.options}>
          <div className="field">
            <span className="field-label" id="len-label">
              Length
            </span>
            <div className="seg" role="group" aria-labelledby="len-label">
              {DURATIONS.map((d) => (
                <button key={d} type="button" aria-pressed={durationSec === d} onClick={() => setDuration(d)}>
                  {d} sec
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field-label" id="tone-label">
              Tone
            </span>
            <div className={styles.chipRow} role="group" aria-labelledby="tone-label">
              {TONES.map((t) => (
                <button key={t} type="button" className="chip" aria-pressed={tone === t} onClick={() => setTone(t)}>
                  {TONE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.voiceRow}>
            <label className="choice">
              <input className="switch" type="checkbox" role="switch" name="voiceover" checked={voiceover} onChange={(e) => setVoiceover(e.target.checked)} />
              AI voice-over
            </label>
            {voiceover ? (
              <div className="select-wrap">
                <label className="sr-only" htmlFor={ids.voice}>
                  Voice
                </label>
                <select id={ids.voice} className="select" name="voice" value={voice} onChange={(e) => setVoice(e.target.value)}>
                  {VOICES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.id}, {v.label.toLowerCase()}
                    </option>
                  ))}
                </select>
                <CaretDown size={16} aria-hidden />
              </div>
            ) : null}
          </div>

          <div className="field">
            <label className="field-label" htmlFor={ids.audience}>
              Who is it for? <span className="t-tertiary">(optional)</span>
            </label>
            <input
              id={ids.audience}
              className="input"
              type="text"
              name="audience"
              autoComplete="off"
              maxLength={LIMITS.audience}
              placeholder="Busy parents, first-time founders…"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
            />
          </div>
        </div>

        {error ? <ErrorNotice message={error} /> : null}

        <div className={styles.actions}>
          <button className="btn btn-ghost" type="button" onClick={() => void startBlank()} disabled={busy !== null} aria-busy={busy === "blank"}>
            <PencilSimple size={18} aria-hidden />
            Write it myself
          </button>
          {aiReady ? (
            <button className="btn btn-volt btn-lg" type="submit" disabled={busy !== null} aria-busy={busy === "hooks"}>
              {busy === "hooks" ? "Finding hooks…" : "Find the hook"}
              {busy === "hooks" ? null : <ArrowRight size={18} weight="bold" aria-hidden />}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="notice is-error" role="alert">
      <WarningCircle size={20} aria-hidden />
      <p>{message}</p>
    </div>
  );
}
