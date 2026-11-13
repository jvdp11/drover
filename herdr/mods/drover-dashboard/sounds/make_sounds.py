#!/usr/bin/env python3
"""Synthesize the pasture sounds (stdlib + lame). Written for this mod, CC0 1.0 (public domain).

bleat.mp3: soft sheep bleat (a worker is done).  chime.mp3: happy chime (a merge).
Run: python3 make_sounds.py   (needs `lame` on PATH)
"""
import math, os, random, struct, subprocess, tempfile, wave

HERE = os.path.dirname(os.path.abspath(__file__))
R = 22050


def save(name, xs):
    peak = max(abs(x) for x in xs) or 1
    tmp = os.path.join(tempfile.mkdtemp(), name + ".wav")
    with wave.open(tmp, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(R)
        w.writeframes(b"".join(struct.pack("<h", int(x / peak * 0.5 * 32767)) for x in xs))
    subprocess.run(["lame", "--quiet", "-m", "m", "-b", "48", tmp, os.path.join(HERE, name + ".mp3")], check=True)


def bleat():
    # a breathy buzz around 330 Hz with a fast wobble, low-passed, gentle fade
    n, xs, ph, lp1, lp2 = int(R * 0.7), [], 0.0, 0.0, 0.0
    random.seed(3)
    for i in range(n):
        t = i / R
        ph += 330 * (1 + 0.06 * math.sin(2 * math.pi * 7 * t)) * (1 - 0.12 * t) / R
        src = (ph % 1) * 2 - 1 + 0.15 * (random.random() * 2 - 1)
        lp1 += 0.18 * (src - lp1)
        lp2 += 0.5 * (lp1 - lp2)
        env = min(1, t / 0.06) * (1 - t / 0.7) ** 1.5 * (0.75 + 0.25 * math.sin(2 * math.pi * 7 * t))
        xs.append(lp2 * env)
    return xs


def chime():
    # three bell tones going up: C6, E6, G6
    n = int(R * 1.1)
    xs = [0.0] * n
    for f, st in ((1046.5, 0), (1318.5, 0.12), (1568, 0.24)):
        for i in range(int(st * R), n):
            t = i / R - st
            xs[i] += math.exp(-t * 5) * (math.sin(2 * math.pi * f * t) + 0.3 * math.sin(2 * math.pi * 2.01 * f * t)) * min(1, t / 0.005)
    return xs


if __name__ == "__main__":
    save("bleat", bleat())
    save("chime", chime())
