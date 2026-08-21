"""Renderiza el orb F2 de Alan (estado reposo) como ícono PWA estático.
Fuente de verdad visual: src/components/alan-orb.css (capas halo / vessel / fa / fb / fc / shell / spec)
y docs/design/redesign-premium/README.md §2-3 (#FFF4E8 núcleo, #4ED6C0 halo, #2E8F86 corriente,
fondo #131519). Safe zone maskable: el contenido queda dentro del 80% central.
Uso: python render_orb_icon.py <out_dir>
"""
import sys, os, math
from PIL import Image, ImageDraw, ImageFilter, ImageChops

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
S = 1024                      # render a 1024 y bajar (antialias)
BG = (0x13, 0x15, 0x19)       # #131519
VESSEL = (0x16, 0x20, 0x1F)   # #16201F
CORE = (0xFF, 0xF4, 0xE8)     # #FFF4E8 blanco cálido
HALO = (0x4E, 0xD6, 0xC0)     # #4ED6C0 turquesa (solo luz)
CUR = (0x2E, 0x8F, 0x86)      # #2E8F86 turquesa profundo

D = int(S * 0.62)             # diámetro del vessel (60% → entra en la safe zone del 80% con halo)
R = D // 2
CX = CY = S // 2


def radial(size, center, radius, color, stops):
    """Capa RGBA con gradiente radial. stops: [(pos 0..1, alpha 0..1), ...] interpolado lineal."""
    w, h = size
    layer = Image.new("RGBA", size, color + (0,))
    px = layer.load()
    cx, cy = center
    for y in range(h):
        dy = y - cy
        for x in range(w):
            dx = x - cx
            t = math.hypot(dx, dy) / radius
            if t >= stops[-1][0]:
                continue
            a = stops[-1][1]
            for i in range(1, len(stops)):
                p0, a0 = stops[i - 1]
                p1, a1 = stops[i]
                if t <= p1:
                    a = a0 + (a1 - a0) * ((t - p0) / (p1 - p0) if p1 > p0 else 0)
                    break
            px[x, y] = color + (int(max(0, min(1, a)) * 255),)
    return layer


def circle_mask(size, center, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).ellipse([center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius], fill=255)
    return m


def render():
    img = Image.new("RGBA", (S, S), BG + (255,))

    # 1) Halo exterior: radial turquesa op 0.18 → 0 al 70%, desenfocado (como .halo con inset -30%)
    halo_r = int(R * 1.65)
    halo = radial((S, S), (CX, CY), halo_r, HALO, [(0.0, 0.34), (0.70, 0.0), (1.0, 0.0)])
    halo = halo.filter(ImageFilter.GaussianBlur(R * 0.12))
    img.alpha_composite(halo)

    # 2) Sombra suave debajo del vessel (0 22px 46px -18px rgba(0,0,0,.95))
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse([CX - R * 0.92, CY - R * 0.92 + R * 0.22, CX + R * 0.92, CY + R * 0.92 + R * 0.22], fill=(0, 0, 0, 200))
    shadow = shadow.filter(ImageFilter.GaussianBlur(R * 0.16))
    img.alpha_composite(shadow)

    # 3) Vessel: base #16201F recortada al círculo, con las tres corrientes adentro
    vessel = Image.new("RGBA", (S, S), VESSEL + (255,))
    # radio de referencia de los flows: inset -30% → ancho 160% del vessel; el gradiente usa "circle at x% y%"
    fw = D * 1.6
    fx0 = CX - fw / 2
    fy0 = CY - fw / 2
    # .fa: blanco cálido en 30% 35%, 100% op → 30% al 18% → 0 al 46%
    fa = radial((S, S), (int(fx0 + fw * 0.30), int(fy0 + fw * 0.35)), fw * 0.5, CORE, [(0.0, 1.0), (0.18, 0.30), (0.46, 0.0), (1.0, 0.0)])
    # .fb: turquesa en 70% 62%, 0.9 → 0.25 al 22% → 0 al 54%
    fb = radial((S, S), (int(fx0 + fw * 0.70), int(fy0 + fw * 0.62)), fw * 0.5, HALO, [(0.0, 1.0), (0.22, 0.40), (0.54, 0.0), (1.0, 0.0)])
    # .fc: turquesa profundo en 50% 80%, 0.7 → 0 al 48%
    fc = radial((S, S), (int(fx0 + fw * 0.50), int(fy0 + fw * 0.80)), fw * 0.5, CUR, [(0.0, 0.85), (0.48, 0.0), (1.0, 0.0)])
    blur = R * 0.10  # blur propio del tamaño (hero usa 9px sobre 112)
    for layer in (fc, fb, fa):
        vessel.alpha_composite(layer.filter(ImageFilter.GaussianBlur(blur)))
    # sombra interior inferior (inset 0 -14px 30px rgba(0,0,0,.5))
    inner = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(inner).ellipse([CX - R, CY - R - R * 0.10, CX + R, CY + R - R * 0.10], fill=(0, 0, 0, 0))
    ring = Image.new("L", (S, S), 0)
    ImageDraw.Draw(ring).ellipse([CX - R, CY - R, CX + R, CY + R], fill=255)
    ImageDraw.Draw(ring).ellipse([CX - R * 0.98, CY - R * 1.08, CX + R * 0.98, CY + R * 0.88], fill=0)
    ring = ring.filter(ImageFilter.GaussianBlur(R * 0.12))
    inner.putalpha(ring.point(lambda v: int(v * 0.38)))
    vessel.alpha_composite(inner)

    vmask = circle_mask((S, S), (CX, CY), R)
    vessel_cut = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    vessel_cut.paste(vessel, (0, 0), vmask)
    img.alpha_composite(vessel_cut)

    # 4) Shell: vidrio — gradiente blanco 0.20 en 34% 26% → 0.04 → 0.11 en el borde, + luz superior, + anillo 1px 0.14
    shell = radial((S, S), (int(CX - R + 2 * R * 0.34), int(CY - R + 2 * R * 0.26)), 2 * R, (255, 255, 255), [(0.0, 0.14), (0.44, 0.03), (1.0, 0.10)])
    top_light = Image.new("RGBA", (S, S), (255, 255, 255, 0))
    tl = Image.new("L", (S, S), 0)
    ImageDraw.Draw(tl).ellipse([CX - R, CY - R, CX + R, CY + R], fill=255)
    ImageDraw.Draw(tl).ellipse([CX - R * 0.98, CY - R * 0.86, CX + R * 0.98, CY + R * 1.10], fill=0)
    tl = tl.filter(ImageFilter.GaussianBlur(R * 0.10)).point(lambda v: int(v * 0.18))
    top_light.putalpha(tl)
    shell.alpha_composite(top_light)
    shell_cut = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    shell_cut.paste(shell, (0, 0), vmask)
    img.alpha_composite(shell_cut)
    ImageDraw.Draw(img).ellipse([CX - R, CY - R, CX + R, CY + R], outline=(255, 255, 255, 36), width=max(2, S // 512))

    # 5) Specular: elipse en top 14% / left 25% / 27% × 18%, blanco 0.85 → 0 al 72%, desenfocada
    sw, sh = int(2 * R * 0.27), int(2 * R * 0.18)
    sx, sy = int(CX - R + 2 * R * 0.25), int(CY - R + 2 * R * 0.14)
    spec = Image.new("RGBA", (S, S), (255, 255, 255, 0))
    sm = Image.new("L", (S, S), 0)
    # elipse con gradiente: varias elipses concéntricas
    steps = 24
    for i in range(steps, 0, -1):
        f = i / steps
        a = int(255 * 0.85 * max(0.0, 1 - f / 0.72) ** 1.2) if f < 0.72 else 0
        if a <= 0:
            continue
        ImageDraw.Draw(sm).ellipse([sx + sw / 2 - sw / 2 * f, sy + sh / 2 - sh / 2 * f, sx + sw / 2 + sw / 2 * f, sy + sh / 2 + sh / 2 * f], fill=a)
    sm = sm.filter(ImageFilter.GaussianBlur(R * 0.035))
    spec.putalpha(sm)
    img.alpha_composite(spec)

    return img.convert("RGB")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    big = render()
    big.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, "alan-512.png"), optimize=True)
    big.resize((192, 192), Image.LANCZOS).save(os.path.join(OUT, "alan-192.png"), optimize=True)
    # favicon: el ICO lleva varios tamaños; fondo opaco #131519 (el orb se lee sobre cualquier tab).
    fav = big.resize((256, 256), Image.LANCZOS)
    fav.save(os.path.join(OUT, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    # preview con máscara circular (iOS/Android) para ver la safe zone
    prev = Image.new("RGB", (64 + 512 + 64 + 512 + 32 + 192 + 64, 512 + 128), BG)
    p512 = big.resize((512, 512), Image.LANCZOS)
    prev.paste(p512, (64, 64))
    masked = Image.new("RGB", (512, 512), (40, 40, 44))
    masked.paste(p512, (0, 0), circle_mask((512, 512), (256, 256), 256))
    prev.paste(masked, (512 + 128, 64))
    prev.paste(big.resize((192, 192), Image.LANCZOS), (64 + 512 + 64 + 512 + 32, 64 + 512 - 192))
    prev.save(os.path.join(OUT, "preview.png"))
    print("ok", OUT)
