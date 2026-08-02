import sys
from pathlib import Path

from PIL import Image

ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"
PNG_PATH = ASSETS_DIR / "icon.png"
ICO_PATH = ASSETS_DIR / "icon.ico"


def main() -> None:
    if not PNG_PATH.exists():
        print(f"Source icon not found: {PNG_PATH}", file=sys.stderr)
        sys.exit(1)

    with Image.open(PNG_PATH) as source:
        source.save(
            ICO_PATH,
            sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
        )
    print(f"Converted {PNG_PATH} -> {ICO_PATH}")


if __name__ == "__main__":
    main()
