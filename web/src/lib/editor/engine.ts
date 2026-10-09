import type { Asset } from "./assets";
import { canFilter, drawScene, type Picture, type TextBox } from "./compose";
import { duckAt, duckLine, ducks, type DuckPoint } from "./duck";
import { newEdit, type Edit } from "./model";
import type { Envelope } from "./silence";
import { audioLength, clipLength, fade, momentAt, totalDuration, type Moment } from "./timeline";

/*
 * The preview: plays an edit in the browser and draws it on a canvas, frame by frame, with the
 * same drawing code as the export (compose.ts). The main track's <video> elements do the
 * decoding and make the sound; while one plays, its own clock is the edit's clock, so picture,
 * sound and playhead can't drift apart. Photos and gaps in loading run on the wall clock.
 */

/** How far a player may be from where it should be before it's moved there. */
const DRIFT = 0.3;

export class Engine {
  edit: Edit = newEdit();
  assets: ReadonlyMap<string, Asset> = new Map();
  time = 0;
  playing = false;
  /** The text layer being worked on in the preview (see selectText). */
  selectedText: string | null = null;
  /** Where the text layers were last drawn (canvas pixels). */
  boxes: TextBox[] = [];
  /** The size of the canvas `boxes` were measured on. */
  surface = { width: 0, height: 0 };
  /** No sound from the edit while a voiceover is being recorded (see setSilent). */
  silent = false;
  readonly filters = canFilter();

  private canvas: HTMLCanvasElement | null = null;
  private font = "system-ui, sans-serif";
  private frame = 0;
  private last = 0;
  /** The clip that was playing on the last frame. */
  private active: string | null = null;
  private sounds = new Map<string, HTMLAudioElement>();
  private watched = new WeakSet<HTMLVideoElement>();
  private listeners = new Set<() => void>();
  private painted = new Set<() => void>();
  /** The level of the sounds that duck under speech, and what it was worked out from. */
  private ducking: { edit: Edit; heard: number; line: DuckPoint[] } | null = null;

  /** Called on every change of time or of playing. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit() {
    for (const listener of this.listeners) listener();
  }

  /** Called after every frame is drawn, when `boxes` says where the text now is (the preview's frame around the selected text follows it). */
  onDraw(listener: () => void): () => void {
    this.painted.add(listener);
    return () => this.painted.delete(listener);
  }

  /** The text layer being worked on (null: none): shown whole while paused, and framed by the preview. */
  selectText(id: string | null) {
    this.selectedText = id;
    this.refresh();
  }

  setSilent(silent: boolean) {
    this.silent = silent;
  }

  attach(canvas: HTMLCanvasElement | null, font?: string) {
    this.canvas = canvas;
    if (font) this.font = font;
    this.refresh();
  }

  setEdit(edit: Edit) {
    this.edit = edit;
    const total = totalDuration(edit);
    if (this.time > total) this.time = total;
    // Sounds that left the edit stop.
    const kept = new Set(edit.audio.map((a) => a.id));
    for (const [id, el] of this.sounds) {
      if (kept.has(id)) continue;
      el.pause();
      el.removeAttribute("src");
      this.sounds.delete(id);
    }
    this.refresh();
    this.emit();
  }

  setAssets(assets: ReadonlyMap<string, Asset>) {
    this.assets = assets;
    for (const asset of assets.values()) {
      const video = asset.video;
      if (!video || this.watched.has(video)) continue;
      this.watched.add(video);
      // A frame arrives some time after a seek: draw it when it does.
      for (const event of ["seeked", "loadeddata", "canplay"]) video.addEventListener(event, () => this.refresh());
    }
    this.refresh();
  }

  get total() {
    return totalDuration(this.edit);
  }

  play() {
    if (this.playing || this.total <= 0) return;
    if (this.time >= this.total - 0.05) this.time = 0;
    this.playing = true;
    this.active = null;
    this.last = performance.now();
    this.emit();
    this.loop();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    // The loop's next frame is called off: left pending, its id would stand in the way of every redraw after this.
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.quiet();
    this.emit();
    this.refresh();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(time: number) {
    this.time = Math.min(this.total, Math.max(0, time));
    this.active = null;
    this.last = performance.now();
    if (!this.playing) this.park();
    this.emit();
    this.refresh();
  }

  /** Step by frames of the export (30 a second). */
  step(frames: number) {
    this.pause();
    this.seek(Math.round(this.time * 30 + frames) / 30);
  }

  /** Draw once, soon (when something changed while paused). */
  refresh() {
    if (this.playing || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw(momentAt(this.edit, this.time));
    });
  }

  dispose() {
    this.playing = false;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.quiet();
    for (const el of this.sounds.values()) el.removeAttribute("src");
    this.sounds.clear();
    this.listeners.clear();
    this.painted.clear();
    this.canvas = null;
  }

  /* ------------------------------ Playing ------------------------------ */

  private loop() {
    cancelAnimationFrame(this.frame);
    const tick = (now: number) => {
      if (!this.playing) {
        this.frame = 0;
        return;
      }
      const elapsed = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      const total = this.total;
      let moment = momentAt(this.edit, this.time);
      const video = moment ? this.assets.get(moment.clip.mediaId)?.video : undefined;
      if (moment && video) {
        // A new clip starts on its own first frame, even when that's only a moment away in the same file (a silence cut out).
        if (moment.clip.id !== this.active) {
          this.active = moment.clip.id;
          if (!video.seeking && Math.abs(video.currentTime - moment.source) > 0.04) video.currentTime = moment.source;
        }
        this.drive(video, moment);
        if (video.ended) this.time = moment.to;
        else if (!video.seeking && !video.paused && video.readyState >= 3) {
          // The video's clock is the edit's clock. It never runs the playhead backwards by a hair (a seek lands a frame early).
          const implied = moment.from + (video.currentTime - moment.clip.start) / moment.clip.speed;
          this.time = Math.abs(implied - this.time) > DRIFT ? implied : Math.max(this.time, implied);
        }
      } else {
        this.time += elapsed;
      }
      if (this.time >= total) {
        this.time = total;
        this.playing = false;
        this.quiet();
        this.emit();
        this.draw(momentAt(this.edit, this.time));
        this.frame = 0;
        return;
      }
      moment = momentAt(this.edit, this.time);
      // Every other video rests.
      for (const asset of this.assets.values()) {
        if (asset.video && asset.media.id !== moment?.clip.mediaId && !asset.video.paused) asset.video.pause();
      }
      this.driveSounds();
      this.draw(moment);
      this.emit();
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  /** Keep the playing clip's <video> on its moment, at its speed and loudness. */
  private drive(video: HTMLVideoElement, moment: Moment) {
    const { clip } = moment;
    if (video.playbackRate !== clip.speed) video.playbackRate = clip.speed;
    const level = clip.volume * fade(moment.local, clipLength(clip), clip.fadeIn, clip.fadeOut);
    video.muted = clip.muted || this.silent;
    video.volume = Math.min(1, Math.max(0, level));
    if (video.seeking) return;
    if (video.paused || Math.abs(video.currentTime - moment.source) > DRIFT) {
      if (Math.abs(video.currentTime - moment.source) > 0.04) video.currentTime = moment.source;
      void video.play().catch(() => undefined);
    }
  }

  /** How far down the ducking sounds are now: worked out again when the edit changes, or another file's loudness arrives. */
  private duckLevel(): number {
    if (!ducks(this.edit)) return 1;
    const envelopes = new Map<string, Envelope>();
    for (const [id, asset] of this.assets) if (asset.envelope) envelopes.set(id, asset.envelope);
    if (this.ducking?.edit !== this.edit || this.ducking.heard !== envelopes.size) this.ducking = { edit: this.edit, heard: envelopes.size, line: duckLine(this.edit, envelopes) };
    return duckAt(this.ducking.line, this.time);
  }

  /** Music and voiceovers follow the playhead. */
  private driveSounds() {
    const total = this.total;
    const ducked = this.duckLevel();
    for (const sound of this.edit.audio) {
      const asset = this.assets.get(sound.mediaId);
      if (!asset) continue;
      const local = this.time - sound.at;
      const length = audioLength(sound);
      const on = this.playing && local >= 0 && local < length && this.time < total;
      let el = this.sounds.get(sound.id);
      if (!on) {
        if (el && !el.paused) el.pause();
        continue;
      }
      if (!el) {
        el = new Audio(asset.url);
        el.preload = "auto";
        this.sounds.set(sound.id, el);
      }
      el.muted = this.silent;
      el.volume = Math.min(1, Math.max(0, sound.volume * fade(local, length, sound.fadeIn, sound.fadeOut) * (sound.duck ? ducked : 1)));
      const want = sound.start + local;
      if (el.paused || Math.abs(el.currentTime - want) > DRIFT) {
        if (Math.abs(el.currentTime - want) > 0.04) el.currentTime = want;
        void el.play().catch(() => undefined);
      }
    }
  }

  /** Everything stops making sound. */
  private quiet() {
    for (const asset of this.assets.values()) if (asset.video && !asset.video.paused) asset.video.pause();
    for (const el of this.sounds.values()) if (!el.paused) el.pause();
  }

  /** Paused: put the video under the playhead on its frame. */
  private park() {
    const moment = momentAt(this.edit, this.time);
    const video = moment ? this.assets.get(moment.clip.mediaId)?.video : undefined;
    if (!moment || !video) return;
    if (!video.paused) video.pause();
    if (Math.abs(video.currentTime - moment.source) > 0.01) video.currentTime = moment.source;
  }

  /* ------------------------------ Drawing ------------------------------ */

  private picture(moment: Moment | null): Picture | null {
    if (!moment) return null;
    const asset = this.assets.get(moment.clip.mediaId);
    if (asset?.bitmap) return { image: asset.bitmap, width: asset.bitmap.width, height: asset.bitmap.height };
    const video = asset?.video;
    if (video && video.readyState >= 2 && video.videoWidth > 0) return { image: video, width: video.videoWidth, height: video.videoHeight };
    return null;
  }

  private draw(moment: Moment | null) {
    const canvas = this.canvas;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    this.surface = { width: canvas.width, height: canvas.height };
    this.boxes = drawScene(ctx, canvas.width, canvas.height, {
      edit: this.edit,
      time: this.time,
      total: this.total,
      moment,
      picture: this.picture(moment),
      font: this.font,
      filters: this.filters,
      selectedText: this.selectedText,
      paused: !this.playing,
    });
    for (const listener of this.painted) listener();
  }
}
