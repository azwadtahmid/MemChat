"""Generates the ink-wash scenery for MemChat as SVG path data.

Run from memory-app/frontend:  python scripts/gen_scenery.py
Writes src/scenery/paths.ts. Deterministic: the same output every run.

Every shape is built from periodic functions over the tile width W, so the
drifting layers loop seamlessly. Brush strokes are ribbons whose width
varies along the path, so they read as a brush rather than a pen.
"""

import math
import random
from pathlib import Path

W = 1440  # one tile; each layer draws two tiles and drifts by one
H = 200   # height of the scenery band


def fmt(v: float) -> str:
    return f"{v:.1f}".rstrip("0").rstrip(".")


def ridge(seed: int, base: float, amp: float, sharp: float, step: int = 12):
    """A periodic mountain ridge: list of (x, y) over two tiles."""
    rnd = random.Random(seed)
    waves = [(k, rnd.uniform(0.35, 1.0) / (k ** 0.55), rnd.uniform(0, 2 * math.pi)) for k in (1, 2, 3, 5, 8, 13)]
    jitter = [(k, rnd.uniform(0.05, 0.12) / (k ** 0.3), rnd.uniform(0, 2 * math.pi)) for k in (21, 34, 55)]
    raw = []
    for x in range(0, 2 * W + step, step):
        t = 2 * math.pi * x / W
        v = sum(a * math.sin(k * t + p) for k, a, p in waves)
        v += sum(a * math.sin(k * t + p) for k, a, p in jitter)
        raw.append((x, v))
    lo, hi = min(v for _, v in raw), max(v for _, v in raw)
    return [(x, base - amp * ((v - lo) / (hi - lo)) ** sharp) for x, v in raw]


def fill_path(points, bottom: float) -> str:
    d = f"M{fmt(points[0][0])} {fmt(bottom)}"
    d += "".join(f"L{fmt(x)} {fmt(y)}" for x, y in points)
    d += f"L{fmt(points[-1][0])} {fmt(bottom)}Z"
    return d


def ribbon(points, width_fn) -> str:
    """A brush stroke along points: width varies, ends taper to a point."""
    n = len(points)
    top, bot = [], []
    for i, (x, y) in enumerate(points):
        a, b = points[max(i - 1, 0)], points[min(i + 1, n - 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dy) or 1
        nx, ny = -dy / length, dx / length
        w = width_fn(i / (n - 1)) / 2
        top.append((x + nx * w, y + ny * w))
        bot.append((x - nx * w, y - ny * w))
    pts = top + bot[::-1]
    return "M" + "L".join(f"{fmt(x)} {fmt(y)}" for x, y in pts) + "Z"


def periodic_width(seed: int, lo: float, hi: float):
    """Brush pressure that varies along a whole-tile stroke and loops seamlessly."""
    rnd = random.Random(seed)
    parts = [(k, rnd.uniform(0, 2 * math.pi)) for k in (3, 7, 17, 29)]

    def fn(u):
        v = sum(math.sin(k * 2 * math.pi * u * 2 + p) / (1 + j) for j, (k, p) in enumerate(parts))
        return lo + (hi - lo) * (0.5 + 0.5 * math.tanh(v))

    return fn


def taper(lo: float, hi: float, seed: int):
    """Pressure for a short stroke: thin at both ends, uneven in the middle."""
    rnd = random.Random(seed)
    k, p = rnd.uniform(2, 4), rnd.uniform(0, 6)

    def fn(u):
        env = math.sin(math.pi * u) ** 0.7
        return lo + (hi - lo) * env * (0.75 + 0.25 * math.sin(k * math.pi * u + p))

    return fn


# ---------- Landscape layers, back to front ----------

far = ridge(seed=11, base=150, amp=110, sharp=1.5)
mid = ridge(seed=23, base=165, amp=78, sharp=1.8)
near = ridge(seed=37, base=182, amp=46, sharp=2.1)

layers = {
    "farFill": fill_path(far, H), "farEdge": ribbon(far, periodic_width(5, 0.6, 2.6)),
    "midFill": fill_path(mid, H), "midEdge": ribbon(mid, periodic_width(7, 0.8, 3.4)),
    "nearFill": fill_path(near, H), "nearEdge": ribbon(near, periodic_width(9, 1.0, 4.2)),
}

# Still water: short tapered horizontal strokes with gaps, looping over two tiles.
rnd = random.Random(101)
water = []
x = 10.0
while x < W - 60:  # one tile; the component draws it twice, so the loop is seamless
    length = rnd.uniform(40, 150)
    y = 190 + rnd.uniform(-2.5, 2.5)
    pts = [(x + length * i / 12, y + math.sin(i / 12 * math.pi * 2 + rnd.random()) * 0.6) for i in range(13)]
    water.append(ribbon(pts, taper(0.2, rnd.uniform(1.2, 2.4), rnd.randrange(999))))
    x += length + rnd.uniform(18, 70)
# Make the second tile repeat the first exactly.
first = [d for d in water]
layers["water"] = "".join(first)

# ---------- Outcrop with pines (static, lower right; 280 x 170 box) ----------

rnd = random.Random(202)
rock_top = []
for i in range(0, 29):
    xx = 18 + i * 9
    env = math.sin(math.pi * i / 28) ** 0.8
    rock_top.append((xx, 170 - 88 * env - rnd.uniform(-6, 6) * env))
rock = fill_path(rock_top, 172)
rock_edge = ribbon(rock_top, taper(0.8, 4.5, 3))
# Cracks and texture strokes on the rock face.
cracks = []
for c in range(6):
    cx = rnd.uniform(60, 220)
    cy = rnd.uniform(110, 160)
    pts = [(cx + i * rnd.uniform(2.5, 4.5), cy + i * rnd.uniform(1, 3) * (1 if c % 2 else -1)) for i in range(7)]
    cracks.append(ribbon(pts, taper(0.2, rnd.uniform(1.0, 2.2), c)))


def pine(bx: float, by: float, height: float, lean: float, seed: int) -> str:
    r = random.Random(seed)
    trunk = [(bx + lean * (i / 10) ** 1.4 * height * 0.35 + r.uniform(-0.6, 0.6), by - height * i / 10) for i in range(11)]
    d = ribbon(trunk, lambda u: 3.2 * (1 - u) + 0.6)
    tx, ty = trunk[-1]
    # Foliage: layered horizontal clumps, wider lower down, drawn as fat tapered strokes.
    for tier in range(5):
        fy = ty + tier * height * 0.14
        fx = bx + lean * ((1 - tier * 0.14) ** 1.4) * height * 0.35
        half = 10 + tier * 7 + r.uniform(-3, 3)
        pts = [(fx - half + 2 * half * i / 10, fy + math.sin(i / 10 * math.pi) * -3 + r.uniform(-1, 1)) for i in range(11)]
        d += ribbon(pts, taper(1.0, 5.5 + tier * 0.6, seed * 10 + tier))
    return d


outcrop = {
    "rock": rock,
    "rockEdge": rock_edge + "".join(cracks),
    "pines": pine(118, 98, 70, 0.6, 1) + pine(168, 94, 92, -0.4, 2) + pine(205, 112, 54, 0.9, 3),
}

# ---------- Knotted cord for the logo (32 x 32) ----------
# A cord tied in a loop, the knot you tie to remember something. The path is a
# smooth spline through hand-placed points, drawn as a brush ribbon: thin at
# the frayed ends, fuller through the loop.

def catmull(points, per=14):
    out = []
    pts = [points[0]] + points + [points[-1]]
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for j in range(per):
            t = j / per
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2
                                    + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3) for k in (0, 1)))
    out.append(points[-1])
    return out

knot_pts = catmull([(4.6, 29.4), (9.6, 23.6), (16.2, 16.6), (21.4, 11.2), (22.4, 6.4), (18.8, 2.9), (13.8, 3.3),
                    (10.2, 6.8), (10.6, 11.6), (14.6, 15.6), (20.2, 21.2), (24.6, 25.8), (27.8, 29.6)])

def knot_width(u):
    ends = min(1.0, u / 0.09, (1 - u) / 0.09)  # frayed, tapering ends
    return 0.7 + 2.5 * ends * (0.85 + 0.15 * math.sin(u * 11 + 0.6))

knot = ribbon(knot_pts, knot_width).replace("M", "M", 1)

# ---------- Write ----------

out = ["// Generated by scripts/gen_scenery.py. Do not edit by hand.", ""]
out.append(f"export const TILE = {W}")
out.append(f"export const BAND = {H}")
for k, v in layers.items():
    out.append(f"export const {k} = '{v}'")
for k, v in outcrop.items():
    out.append(f"export const {k} = '{v}'")
out.append(f"export const knot = '{knot}'")
Path("src/scenery").mkdir(parents=True, exist_ok=True)
Path("src/scenery/paths.ts").write_text("\n".join(out) + "\n", encoding="utf-8")
print("wrote src/scenery/paths.ts", Path("src/scenery/paths.ts").stat().st_size // 1024, "KB")
