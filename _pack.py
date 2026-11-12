import os
import zipfile

OUT = "Nestory-V3.0-source.zip"
ROOT_FILES = [
    "index.html",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "tsconfig.app.json",
    "tsconfig.node.json",
    "vite.config.ts",
    "README.md",
    "BRAND.md",
    "AUDIT.md",
    ".gitignore",
    "_e2e.mjs",
    "_e2e_profile.mjs",
    "_e2e_settings.mjs",
    "_e2e_layout.mjs",
    "_e2e_album.mjs",
    "_e2e_home.mjs",
    "_e2e_sleep.mjs",
    "_e2e_lightbox.mjs",
    "_e2e_viewport.mjs",
    "_e2e_tap.mjs",
    "_e2e_back.mjs",
    "_e2e_exit.mjs",
    "_e2e_auth.mjs",
    "_e2e_onboarding.mjs",
    "_e2e_autosave.mjs",
    "_login_session.mjs",
    "_shot.mjs",
    "_ui_shot.mjs",
    "_probe.mjs",
]

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for folder in ("src", "public", "backend", "_test"):
        for base, _dirs, files in os.walk(folder):
            if "__pycache__" in base or os.sep + "logs" in base:
                continue
            for name in files:
                if name.endswith(".pyc") or name in {"llm.env", "db.env"}:
                    continue
                path = os.path.join(base, name)
                zf.write(path, path)
    for name in ROOT_FILES:
        if os.path.exists(name):
            zf.write(name, name)
    for name in sorted(os.listdir("shots")):
        keep = name.startswith(("final-", "sheet-", "e2e-", "onboarding-")) or name in {
            "album-live-lightbox.png",
            "album-video-lightbox.png",
            "album-lightbox.png",
            "home-slide-2.png",
            "hero-grid-add.png",
            "hero-pick-step.png",
        }
        if keep:
            path = os.path.join("shots", name)
            zf.write(path, path)

size = os.path.getsize(OUT) / 1024 / 1024
print(f"packed {OUT}: {size:.2f} MB")
