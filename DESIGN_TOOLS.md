# Bamio design tools

Setup completed and verified on 2026-09-25. This file records what is installed, where it lives, how each tool is used in the Bamio design process, and what each one cannot do.

Environment at setup: Windows 11, Node 24.20.0, npm 11.19.0, git 2.55, Python 3.14.7, Claude Code (VS Code extension).

## Summary

| Tool | Status | Location |
|---|---|---|
| Taste skills (6 of 13) | Installed, verified | `.claude/skills/<name>/SKILL.md` |
| Image-to-Code skill | Installed, verified (with limitation) | `.claude/skills/image-to-code/SKILL.md` |
| Vercel web-design-guidelines | Installed, verified | `.claude/skills/web-design-guidelines/SKILL.md` |
| Awesome Design (DESIGN.md library) | Cloned, 74 references | `references/awesome-design-md/design-md/` (gitignored) |
| Playwright CLI 0.1.21 + skill | Installed, smoke-tested | global `playwright-cli`, `.claude/skills/playwright-cli/`, `.playwright/cli.config.json` |

"Verified" means: the files exist on disk, Claude Code lists the skill as available in-session, and the full `SKILL.md` has been read. For Playwright it also means a real browser session was opened, resized and screenshotted (details below).

Skill versions are pinned by content hash in `skills-lock.json` (commit this file). Restore on a fresh clone with `npx skills experimental_install`.

---

## 1. Taste skills

- **Source:** https://github.com/Leonxlnx/taste-skill (site: https://www.tasteskill.dev/)
- **Install method** (official, current as of setup, via the `skills` CLI from skills.sh):
  ```sh
  npx skills add Leonxlnx/taste-skill -a claude-code -y --copy \
    -s design-taste-frontend image-to-code high-end-visual-design redesign-existing-projects brandkit imagegen-frontend-web
  ```
  - `-a claude-code` installs for Claude Code only, `-y` skips prompts (the session is non-interactive).
  - `--copy` copies files instead of symlinking. Symlinks on Windows need Developer Mode, so copies are more reliable.
  - Scope is project-level (`.claude/skills/`), so the skills travel with this repo.
- **Security scan at install:** all six skills rated Safe / 0 alerts / Low Risk (Gen, Socket, Snyk).

### Installed skills and their job in Bamio

| Skill (install name) | Repo path | Used for |
|---|---|---|
| `design-taste-frontend` | `skills/taste-skill/` | **Primary taste authority.** Design read, the three dials (variance / motion / density), anti-slop rules, pre-flight checklist. Governs the landing page and all marketing surfaces. Its general rules (color lock, shape lock, em-dash ban, full UI states, copy audit) apply everywhere. |
| `image-to-code` | `skills/image-to-code-skill/` | Turning visual references (screenshots, mockups, our own comps) into faithful UI: deep image analysis, extraction of type/spacing/color, anti-drift during implementation. |
| `brandkit` | `skills/brandkit/` | Phase A method: strategy first, then the symbol logic, logo concept methods, and the brand-board panel system. |
| `high-end-visual-design` | `skills/soft-skill/` | Premium detail vocabulary: spring easing curves, button-with-nested-icon, concentric radii, grain overlays. Used selectively (see conflicts). |
| `redesign-existing-projects` | `skills/redesign-skill/` | Audit checklist for review passes at the end of every phase and in Phase M. |
| `imagegen-frontend-web` | `skills/imagegen-frontend-web/` | Art-direction vocabulary for landing-page sections (hero composition variety, one-section-one-reference discipline). |

### Not installed, and why

| Skill | Reason |
|---|---|
| `design-taste-frontend-v1` | Legacy version of the skill already installed. |
| `gpt-taste` | GPT/Codex variant. Forces Python-driven layout randomization and heavy GSAP; conflicts with the primary skill. |
| `minimalist-ui`, `industrial-brutalist-ui` | Single-aesthetic style locks. Installing them before brand exploration would bias Phase A. Can be added later if a direction calls for them. |
| `stitch-design-taste` | Google Stitch-specific output format. |
| `full-output-enforcement` | Output-length enforcement; not a design capability. |
| `imagegen-frontend-mobile` | Image generation only, and no image generator is available (see limitation). |

Add any of them later with `npx skills add Leonxlnx/taste-skill -a claude-code -y --copy -s <name>`.

### Limitations

1. **No image-generation tool is available in this environment.** `image-to-code`, `imagegen-frontend-web` and `brandkit` are written to generate images first, then code from them. Here they run in *reference-in* mode instead:
   - brand boards and comps are built directly as HTML/CSS/SVG,
   - the image-analysis and anti-drift rules are applied to user-supplied screenshots, to Playwright screenshots of our own comps, and to reference sites,
   - if an image tool is connected later, these skills can run as designed.
2. **`design-taste-frontend` declares dashboards, editors, timelines and multi-step wizards out of scope** (its Section 13). That covers most of Bamio (phases D to K). For those surfaces we apply only its general rules, and lean on `web-design-guidelines`, the product-UI references (Linear, Raycast, Figma, Superhuman, Warp) and established editor conventions.
3. `image-to-code` was written for Codex. Its "one image per section" counts assume an image generator, so they are guidance only here.
4. Photography: with no generator, placeholder imagery comes from `https://picsum.photos/id/{id}/{w}/{h}` (IDs chosen by eye) and is labeled as placeholder. Final imagery needs real or generated assets.

---

## 2. Vercel web-design-guidelines

- **Source:** https://github.com/vercel-labs/agent-skills (`skills/web-design-guidelines/`)
- **Install method:**
  ```sh
  npx skills add vercel-labs/agent-skills -a claude-code -y --copy -s web-design-guidelines
  ```
  Only this skill was installed. The repo's React, deploy and Vercel-ops skills belong to engineering, not design.
- **How it works:** the skill is a thin wrapper. On every review it fetches the live rules from
  `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`
  (190 lines, 103 rules at setup), reads the target files, and reports findings as `file:line - issue`.
- **Rule categories:** accessibility, focus states, forms, animation, typography, content handling, images, performance, navigation and state, touch, safe areas, dark mode, i18n, hydration, hover states, copy, anti-patterns.
- **Used for:** a compliance pass on every phase's HTML/CSS before that phase is marked complete, plus Phase M. Invoke as `/web-design-guidelines design/<phase>/**/*.html`.
- **Limitations:**
  - Needs network access to fetch the rules. An offline copy can be kept if needed.
  - It is a code review, not a visual review. It cannot judge taste, hierarchy or layout; Playwright screenshots and the Taste checklists cover those.
  - Several rules are React/Next-specific (hydration, `nuqs`, `<Link>`). They are skipped for static HTML comps and apply again during engineering.

---

## 3. Image-to-Code skill

- **Source:** https://github.com/Leonxlnx/taste-skill/blob/main/skills/image-to-code-skill/SKILL.md
- **Install method:** installed as part of the Taste set above (`-s image-to-code`).
- **Verified:** present at `.claude/skills/image-to-code/SKILL.md` (1,229 lines, read in full) and listed by Claude Code as an available skill.
- **Workflow used in Bamio:**
  1. Capture the reference: user screenshot, reference site, or a Playwright screenshot of the current comp.
  2. Run the skill's deep analysis on it (Sections 8-9, 21-25): exact text, type scale, spacing logic, radius, buttons, color, grid.
  3. Implement or adjust the comp.
  4. Screenshot again and compare. The anti-drift rule (Section 27) is the acceptance test: the build must still look like the reference, not a generic re-coding of it.
- **Limitation:** see Taste limitation 1 (no image generation, so reference-in mode only).

---

## 4. Awesome Design (DESIGN.md library)

- **Source:** https://github.com/VoltAgent/awesome-design-md (MIT)
- **Install method:**
  ```sh
  git clone --depth 1 https://github.com/VoltAgent/awesome-design-md.git references/awesome-design-md
  ```
  It is a reference library, not a skill, so nothing is registered with Claude Code. The folder is gitignored because it is a nested git repo; re-clone with the command above. Update with `git -C references/awesome-design-md pull`.
- **Contents:** 74 folders in `design-md/`, each with a `DESIGN.md` covering visual theme, color roles, type scale, components, layout, elevation, do's and don'ts, responsive behavior, and an agent prompt guide.
- **Most relevant references for Bamio:**

  | Need | References |
  |---|---|
  | AI video and creative tools (closest category) | `runwayml`, `elevenlabs`, `framer`, `figma`, `webflow`, `miro` |
  | Product and editor UI craft | `linear.app`, `raycast`, `superhuman`, `warp`, `cursor`, `notion` |
  | Consumer media and content browsing | `spotify`, `apple`, `pinterest`, `playstation` |
  | Dashboards and data | `posthog`, `sentry`, `vercel`, `supabase` |

- **Rules of use:** study, never copy. We borrow reasoning (why a scale, radius or density works), not tokens, fonts, colors or layouts. Any borrowed idea is noted in `DESIGN_STATUS.md` with its source.
- **Limitation:** these files are third-party analyses of live sites, not official brand guidelines. Values can be approximate or out of date.

---

## 5. Playwright CLI

- **Source:** https://github.com/microsoft/playwright-cli
- **Install method** (official README, current as of setup):
  ```sh
  npm install -g @playwright/cli@latest   # installed 0.1.21
  playwright-cli install --skills         # skill -> .claude/skills/playwright-cli, config -> .playwright/cli.config.json
  playwright-cli install-browser chromium # Chrome Headless Shell 154 (fallback engine)
  ```
  The workspace config uses the installed Microsoft Edge (`"channel": "msedge"`) as the default browser. Session output goes to `.playwright-cli/`, which is gitignored.
- **Smoke test performed:** opened a local page over HTTP, resized to 390x844 and 1440x900, read `innerWidth` via `eval`, captured the accessibility snapshot, emulated `prefers-color-scheme: light` and `prefers-reduced-motion: reduce` (both confirmed via `matchMedia`), saved screenshots and visually checked them, then closed the session. All passed.
- **Used for:** visual QA of every comp at the standard viewports, both color schemes, reduced motion, keyboard focus checks (`press Tab` + `screenshot`), and later regression screenshots.
- **Limitations:**
  - **`file://` URLs are blocked.** Serve comps over local HTTP:
    ```sh
    python -m http.server 5178 --bind 127.0.0.1 --directory design
    ```
  - In PowerShell, URLs containing `&` must be passed with `--%` (see the skill's "URLs with `&` on Windows" section).
  - **Run `playwright-cli` from the project root.** It reads `.playwright/cli.config.json` from the current directory. From any subfolder it falls back to the Chrome channel, which is not installed, and fails with "Chromium distribution 'chrome' is not found". Alternative: pass `--config=<root>/.playwright/cli.config.json` to `open`.
  - Screenshots default to viewport-only at CSS pixel scale. Add `--full-page` for the whole scrollable page and `--hires` for device-pixel resolution. Full-page captures of long pages are large, so prefer per-section element screenshots (`screenshot <ref>`).

### Standard QA pass (run for every screen)

```sh
playwright-cli open http://127.0.0.1:5178/<phase>/index.html
playwright-cli resize 390 844   ; playwright-cli screenshot --filename=qa/<screen>-390.png
playwright-cli resize 768 1024  ; playwright-cli screenshot --filename=qa/<screen>-768.png
playwright-cli resize 1280 800  ; playwright-cli screenshot --filename=qa/<screen>-1280.png
playwright-cli resize 1440 900  ; playwright-cli screenshot --filename=qa/<screen>-1440.png
playwright-cli set-color-scheme light ; playwright-cli screenshot --filename=qa/<screen>-light.png
playwright-cli set-reduced-motion reduce
playwright-cli --raw eval "document.documentElement.scrollWidth > innerWidth"   # must be false (no horizontal scroll)
playwright-cli console warning
playwright-cli close
```

---

## How the tools work together

For each phase:

1. **Strategy and read.** `brandkit` method in Phase A; `design-taste-frontend` Section 0 "design read" + dials for every later surface.
2. **Reference study.** Relevant `DESIGN.md` files from `references/awesome-design-md`.
3. **Build the comp** in `design/<phase>/` as static HTML/CSS. Taste rules apply; `high-end-visual-design` is used selectively.
4. **Visual QA** with `playwright-cli` (standard pass above), then `image-to-code` analysis on the screenshots (does the build match the intent?).
5. **Rule audit:** `web-design-guidelines`, the `design-taste-frontend` pre-flight (Section 14), and the `redesign-existing-projects` audit.
6. **Record** decisions and open questions in `DESIGN_STATUS.md`. Stop for review.

### Precedence when skills disagree

| Conflict | Resolution |
|---|---|
| `high-end-visual-design` wants an eyebrow pill above every heading; `design-taste-frontend` caps eyebrows at 1 per 3 sections | Taste cap wins. |
| `high-end-visual-design` wants double-bezel nesting on all cards; `image-to-code` bans cards-in-cards | Nesting only where it expresses real hierarchy. |
| `high-end-visual-design` wants floating pill navs and `py-24`+ everywhere | Marketing pages only. Product UI (phases D-K) follows editor conventions and density needs. |
| `web-design-guidelines` asks for Title Case headings and buttons; `redesign-existing-projects` asks for sentence case | Decide in Phase B. Recommendation: sentence case, which matches the reference set (Linear, Runway, Framer). |
| `web-design-guidelines` requires `…` and curly quotes; `design-taste-frontend` bans em and en dashes | Compatible. Use both. |
| Any skill vs. a documented Bamio decision in `DESIGN_STATUS.md` | The documented decision wins. |

## Other connected tools (not required)

The Figma (`plugin:marketing:figma`) and Canva (`claude.ai Canva`) connectors are configured in this Claude Code install but need authorization before they can be used. Authorize them via `/mcp` in an interactive session (or claude.ai connector settings for Canva). The workflow above does not depend on them.

## Maintenance

```sh
npx skills update -p                                  # update project skills
npx skills experimental_install                       # restore skills from skills-lock.json
npm install -g @playwright/cli@latest                 # update Playwright CLI
git -C references/awesome-design-md pull              # update design references
```

The `skills` CLI sends anonymous install telemetry to skills.sh.
