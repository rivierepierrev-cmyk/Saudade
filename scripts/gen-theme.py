"""Generates src/theme.css: light and dark values for every colour token used in
the UI (`bg-[var(--bg-xxxxxx)]`, `text-[var(--fg-xxxxxx)]`, `border-[var(--bd-xxxxxx)]`).

Usage: python3 scripts/gen-theme.py   (then check with tests/e2e/contrast.cjs)

Dark values keep the hue and remap lightness (OKLCH) by role: surfaces get dark,
text gets light, mid-tone accents used as button backgrounds keep their lightness
(white text on them stays readable). In the light theme, mid-tone text colours
that are too pale are darkened until they reach WCAG AA.
"""
import glob, math, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
used = {'bg': set(), 'fg': set(), 'bd': set()}
for f in glob.glob(os.path.join(ROOT, 'src', '**', '*.tsx'), recursive=True) + [os.path.join(ROOT, 'index.html')]:
    for role, h in re.findall(r'var\(--(bg|fg|bd)-([0-9a-f]{6})\)', open(f, encoding='utf-8').read()):
        used[role].add(h)
# Tokens referenced by the semantic variables below must exist too.
for role, h in [('bg', 'faf7f2'), ('bg', 'ffffff'), ('bg', 'f3efe8'), ('fg', '28231d'), ('fg', '695f54'), ('fg', '9e9385'), ('fg', '8c5e32')]:
    used[role].add(h)
used = {k: sorted(v) for k, v in used.items()}

def srgb_to_lin(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def lin_to_srgb(c): return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
def hex_to_oklch(h):
    r, g, b = (srgb_to_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l, m, s = (x ** (1 / 3) for x in (l, m, s))
    L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
    a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    return L, math.hypot(a, bb), math.atan2(bb, a)
def oklch_to_hex(L, C, H):
    a, b = C * math.cos(H), C * math.sin(H)
    for _ in range(30):  # reduce chroma until in gamut
        l_ = L + 0.3963377774 * a + 0.2158037573 * b
        m_ = L - 0.1055613458 * a - 0.0638541728 * b
        s_ = L - 0.0894841775 * a - 1.2914855480 * b
        l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
        rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
               -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
               -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s]
        if all(-0.0005 <= c <= 1.0005 for c in rgb): break
        a *= 0.9; b *= 0.9
    return '#' + ''.join(f'{round(max(0, min(1, lin_to_srgb(max(0, c)))) * 255):02x}' for c in rgb)
def interp(points, x):
    points = sorted(points)
    if x <= points[0][0]: return points[0][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x <= x1: return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return points[-1][1]

FG = [(0.0, 0.97), (0.25, 0.94), (0.35, 0.91), (0.45, 0.85), (0.55, 0.78), (0.65, 0.68), (0.75, 0.45), (0.85, 0.32), (0.93, 0.25), (1.0, 0.20)]
SURFACE = [(0.75, 0.40), (0.84, 0.33), (0.91, 0.27), (0.95, 0.235), (0.975, 0.205), (1.0, 0.20)]
DARK_TO_LIGHT = [(0.15, 0.93), (0.30, 0.88), (0.42, 0.82)]
BORDER = [(0.75, 0.45), (0.84, 0.40), (0.91, 0.33), (0.95, 0.30), (1.0, 0.28)]

def dark(role, h):
    L, C, H = hex_to_oklch(h)
    if role == 'fg':
        return oklch_to_hex(interp(FG, L), C * (0.85 if L < 0.75 else 0.6), H)
    if h == 'ffffff' and role == 'bg':
        return oklch_to_hex(0.235, 0.008, hex_to_oklch('faf7f2')[2])  # cards: a step above the canvas
    if L >= 0.75:
        return oklch_to_hex(interp(SURFACE if role == 'bg' else BORDER, L), min(C, 0.035) * 0.8, H)
    if L >= 0.42:
        return oklch_to_hex(L * (0.95 if role == 'bg' else 1.05), C, H)  # accents
    return oklch_to_hex(interp(DARK_TO_LIGHT, L), C * 0.6, H)

def rel_lum(h):
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (f(int(h.lstrip('#')[i:i + 2], 16) / 255) for i in (0, 2, 4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
def contrast(a, b):
    x, y = sorted([rel_lum(a), rel_lum(b)], reverse=True)
    return (x + 0.05) / (y + 0.05)

def light(role, h):
    # Mid-tone text colours that are too pale on the beige surfaces get darkened
    # (same hue) until they reach WCAG AA (4.5:1) with a small margin.
    if role != 'fg':
        return '#' + h
    L, C, H = hex_to_oklch(h)
    if not (0.45 <= L <= 0.8) or contrast(h, 'f3efe8') >= 4.6:
        return '#' + h
    while L > 0.2:
        L -= 0.005
        candidate = oklch_to_hex(L, C, H)
        if contrast(candidate, 'f3efe8') >= 4.6:
            return candidate
    return '#' + h

light_lines, dark_lines = [], []
for role in ('bg', 'fg', 'bd'):
    for h in used[role]:
        light_lines.append(f'  --{role}-{h}: {light(role, h)};')
        dark_lines.append(f'  --{role}-{h}: {dark(role, h)};')
# Semantic variables used by index.css
SEM = {'--bg-canvas': ('bg', 'faf7f2'), '--bg-surface': ('bg', 'ffffff'), '--bg-surface-subtle': ('bg', 'f3efe8'),
       '--border-beige': ('bd', 'e8e2d5'), '--border-beige-dark': ('bd', 'ddd6c8'), '--text-primary': ('fg', '28231d'),
       '--text-secondary': ('fg', '695f54'), '--text-muted': ('fg', '9e9385'), '--accent-warm': ('fg', '8c5e32'),
       '--highlight-bg': ('bg', 'f3e6ce'), '--highlight-bg-hover': ('bg', 'ecdab8'), '--cloze-bg': ('bg', 'f2e8d8'),
       '--cloze-border': ('bd', 'b8966e'), '--cloze-text': ('fg', '7a4e26'), '--caption-text': ('fg', '695f54')}
sem_light, sem_dark = [], []
for name, (role, h) in SEM.items():
    sem_light.append(f'  {name}: {light(role, h)};'); sem_dark.append(f'  {name}: {dark(role, h)};')
sem_light.append('  --scrollbar: rgba(180, 168, 150, 0.35);'); sem_dark.append('  --scrollbar: rgba(150, 140, 125, 0.35);')
sem_light.append('  color-scheme: light;'); sem_dark.append('  color-scheme: dark;')
body_dark = '\n'.join(sem_dark + dark_lines)
css = f"""/* Generated colour tokens (generated by scripts/gen-theme.py — do not edit by hand): every colour used in
   the UI is a variable per role (bg / fg = text / bd = border), with a dark variant. */
:root {{
{chr(10).join(sem_light + light_lines)}
}}

:root[data-theme='dark'] {{
{body_dark}
}}

@media (prefers-color-scheme: dark) {{
  :root:not([data-theme='light']) {{
{chr(10).join('  ' + l for l in body_dark.splitlines())}
  }}
}}
"""
open(os.path.join(ROOT, 'src', 'theme.css'), 'w').write(css)
print(len(light_lines), 'tokens')
