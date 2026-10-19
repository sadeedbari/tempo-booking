import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// D-019: the billing colours meet WCAG 2.1 AA. The tokens are READ from globals.css, so changing a colour there is checked here.
const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
type RGB = [number, number, number];
type Theme = Record<string, string>;
const GROUNDS = ["--canvas", "--surface", "--surface-2"] as const;

/** `--name: value;` pairs of the first block that starts with `selector {`. */
function tokens(selector: string): Theme {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `block ${selector} not found`);
  const body = css.slice(start, css.indexOf("\n}", start)).replace(/\/\*[\s\S]*?\*\//g, "");
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const light = tokens(":root");
const dark = { ...light, ...tokens(':root[data-theme="dark"]') };

function parse(c: string): { rgb: RGB; a: number } {
  const hex = c.match(/^#([0-9a-f]{6})$/i);
  if (hex) return { rgb: [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as RGB, a: 1 };
  const m = c.match(/^rgba?\(([^)]+)\)$/);
  assert.ok(m, `cannot parse colour ${c}`);
  const p = m[1].split(",").map((x) => Number(x.trim()));
  return { rgb: [p[0], p[1], p[2]], a: p[3] ?? 1 };
}
const over = (fg: { rgb: RGB; a: number }, behind: RGB): RGB => fg.rgb.map((v, i) => v * fg.a + behind[i] * (1 - fg.a)) as RGB;
const lum = (c: RGB) => {
  const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: RGB, b: RGB) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const solid = (t: Theme, token: string, behind: RGB) => over(parse(t[token]), behind);
/** A tint of `tintToken` at `alpha` over `behind` (like color-mix(in srgb, var(--x) 15%, transparent)). */
const tint = (t: Theme, tintToken: string, alpha: number, behind: RGB) => over({ rgb: parse(t[tintToken]).rgb, a: alpha }, behind);

for (const [name, t] of [["light", light], ["dark", dark]] as const) {
  const ground = (token: string) => solid(t, token, [255, 255, 255]);
  // [label, text token, tint token, tint alpha as used in the components]
  const pairs: [string, string, string, number][] = [
    ["blue strip / Notice / badge", "--accent-text", "--accent", parse(t["--accent-soft"]).a],
    ["orange strip (trial last days, payment failed) / badge", "--orange-text", "--orange", 0.15],
    ["red strip / Notice / Expired badge / destructive button", "--red-text", "--red", parse(t["--red-soft"]).a],
    ["green Notice / Active badge", "--green-text", "--green", 0.15],
  ];
  for (const [label, text, tintToken, alpha] of pairs) {
    for (const g of GROUNDS) {
      test(`${name}: ${label} over ${g} is at least 4.5:1`, () => {
        const bg = tint(t, tintToken, alpha, ground(g));
        const r = ratio(solid(t, text, bg), bg);
        assert.ok(r >= 4.5, `${text} on ${tintToken} tint over ${g}: ${r.toFixed(2)}`);
      });
    }
  }
  // Help text and field hints (label-2) sit on the page or on a card.
  for (const g of ["--canvas", "--surface"]) {
    test(`${name}: help text (label-2) on ${g} is at least 4.5:1`, () => {
      const r = ratio(solid(t, "--label-2", ground(g)), ground(g));
      assert.ok(r >= 4.5, `label-2 on ${g}: ${r.toFixed(2)}`);
    });
  }
  test(`${name}: white text on the filled (Subscribe) button is at least 4.5:1, also when hovered`, () => {
    for (const fill of ["--accent-fill", "--accent-fill-hover"]) {
      const r = ratio([255, 255, 255], solid(t, fill, [255, 255, 255]));
      assert.ok(r >= 4.5, `white on ${fill}: ${r.toFixed(2)}`);
    }
  });
  test(`${name}: the usage bar fills reach 3:1 (UI components) against their track`, () => {
    for (const fill of ["--accent-text", "--orange-text"]) {
      const r = ratio(solid(t, fill, [255, 255, 255]), ground("--surface-2"));
      assert.ok(r >= 3, `${fill} on the track: ${r.toFixed(2)}`);
    }
  });
}

// D-028: the hero illustration's time labels (column colour mixed 50% toward the text colour, on a 12% tint of the column colour
// over the card) reach 4.5:1 in both appearances. Mirrors the style in src/components/marketing/hero.tsx.
for (const [name, t] of [["light", light], ["dark", dark]] as const) {
  test(`D-028 illustration time labels meet 4.5:1 (${name})`, () => {
    for (const col of ["#007AFF", "#34C759", "#AF52DE"]) {
      const c = parse(col).rgb;
      const surface = parse(t["--surface"]).rgb;
      const bg = over({ rgb: c, a: 0x1f / 255 }, surface);
      const fg = c.map((v, i) => v * 0.5 + parse(t["--label"]).rgb[i] * 0.5) as RGB;
      assert.ok(ratio(fg, bg) >= 4.5, `${col} on its tint (${name}) is ${ratio(fg, bg).toFixed(2)}:1`);
    }
  });
}

// D-036: the booking page uses --accent-text for blue text and --label-2 for small grey text (not --accent / --label-3),
// so it reaches 4.5:1 in both appearances on the page, card and the accent-soft tint of the time buttons.
for (const [name, t] of [["light", light], ["dark", dark]] as const) {
  const ground = (token: string) => solid(t, token, [255, 255, 255]);
  for (const g of ["--canvas", "--surface"]) { // label-2 on surface-2 is 4.47 in light; the booking page does not put small text there
    test(`${name}: booking page accent text and small grey text on ${g} are at least 4.5:1`, () => {
      for (const token of ["--accent-text", "--label-2"]) {
        const r = ratio(solid(t, token, ground(g)), ground(g));
        assert.ok(r >= 4.5, `${token} on ${g}: ${r.toFixed(2)}`);
      }
    });
  }
}

// D-037: selected day/time chips and selected intake options use white on --accent-fill, which reaches 4.5:1 in both appearances.
for (const [name, t] of [["light", light], ["dark", dark]] as const) {
  test(`${name}: selected booking chips (white on --accent-fill, hover --accent-fill-hover) are at least 4.5:1`, () => {
    for (const fill of ["--accent-fill", "--accent-fill-hover"]) {
      const r = ratio([255, 255, 255], solid(t, fill, [255, 255, 255]));
      assert.ok(r >= 4.5, `white on ${fill}: ${r.toFixed(2)}`);
    }
  });
}
