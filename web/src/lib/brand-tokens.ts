/*
 * Colours and radii from src/styles/tokens.css, written out for places CSS variables can't reach:
 * emails (mail apps ignore them) and generated images (link previews, rendered by Satori). A unit
 * test (tests/unit/email.test.ts) checks they still match the tokens.
 */
export const TOKENS = {
  paper: {
    "--bg": "#F2F2EE",
    "--surface": "#FBFBF9",
    "--line": "#DADAD4",
    "--text": "#121212",
    "--text-secondary": "#4A4A46",
    "--text-tertiary": "#676761",
    "--on-volt": "#121212",
    "--volt-edge": "#121212",
    "--warning": "#A34A07",
    "--warning-bg": "#FBEAD8",
  },
  night: {
    "--bg": "#0E0E0E",
    "--surface": "#151515",
    "--line": "#2A2A2A",
    "--text": "#EDEDED",
    "--text-secondary": "#A3A3A3",
    "--text-tertiary": "#8A8A8A",
    "--warning": "#F29A4A",
  },
  brand: { "--volt": "#CDEA55", "--ink": "#121212", "--paper": "#F2F2EE" },
  radius: { "--r-sm": "10px", "--r-md": "16px", "--r-pill": "999px" },
} as const;
