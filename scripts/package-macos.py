from __future__ import annotations

import argparse
import io
import plistlib
import shutil
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

from PIL import Image


APP_NAME = "无痕修图"
OLD_ROOT = "Electron.app/"
NEW_ROOT = f"{APP_NAME}.app/"


def clone_info(info: zipfile.ZipInfo, name: str) -> zipfile.ZipInfo:
    cloned = zipfile.ZipInfo(name, date_time=info.date_time)
    cloned.comment = info.comment
    cloned.extra = info.extra
    cloned.create_system = info.create_system
    cloned.create_version = info.create_version
    cloned.extract_version = info.extract_version
    cloned.flag_bits = info.flag_bits
    cloned.internal_attr = info.internal_attr
    cloned.external_attr = info.external_attr
    cloned.compress_type = info.compress_type
    return cloned


def regular_info(name: str, executable: bool = False) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name)
    info.create_system = 3
    mode = 0o100755 if executable else 0o100644
    info.external_attr = mode << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    return info


def create_icns(source: Path) -> bytes:
    image = Image.open(source).convert("RGBA").resize((1024, 1024), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="ICNS", sizes=[(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)])
    return buffer.getvalue()


def update_plist(data: bytes) -> bytes:
    plist = plistlib.loads(data)
    plist["CFBundleDisplayName"] = APP_NAME
    plist["CFBundleExecutable"] = APP_NAME
    plist["CFBundleIdentifier"] = "com.localtools.wuhenxiutu"
    plist["CFBundleName"] = APP_NAME
    plist["CFBundleIconFile"] = "app.icns"
    plist["CFBundleShortVersionString"] = "1.0.0"
    plist["CFBundleVersion"] = "1.0.0"
    plist["NSHighResolutionCapable"] = True
    return plistlib.dumps(plist, fmt=plistlib.FMT_XML, sort_keys=False)


def package(electron_zip: Path, output_zip: Path, app_source: Path, web_root: Path, icon_png: Path) -> None:
    output_zip.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(electron_zip, "r") as source, zipfile.ZipFile(
        output_zip, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9, allowZip64=True
    ) as target:
        for info in source.infolist():
            if not info.filename.startswith(OLD_ROOT):
                continue
            if info.filename.endswith("/Contents/Resources/default_app.asar"):
                continue
            name = NEW_ROOT + info.filename[len(OLD_ROOT):]
            if name == f"{NEW_ROOT}Contents/MacOS/Electron":
                name = f"{NEW_ROOT}Contents/MacOS/{APP_NAME}"
            data = source.read(info)
            if name == f"{NEW_ROOT}Contents/Info.plist":
                data = update_plist(data)
            target.writestr(clone_info(info, name), data)

        resource_root = f"{NEW_ROOT}Contents/Resources"
        target.writestr(regular_info(f"{resource_root}/app.icns"), create_icns(icon_png))

        for source_file in sorted(app_source.rglob("*")):
            if source_file.is_file():
                relative = PurePosixPath(source_file.relative_to(app_source).as_posix())
                target.writestr(regular_info(f"{resource_root}/app/{relative}"), source_file.read_bytes())
        for source_file in sorted(web_root.rglob("*")):
            if source_file.is_file():
                relative = PurePosixPath(source_file.relative_to(web_root).as_posix())
                target.writestr(regular_info(f"{resource_root}/app/wwwroot/{relative}"), source_file.read_bytes())


def main() -> None:
    parser = argparse.ArgumentParser(description="Package an unsigned macOS Electron app on Windows")
    parser.add_argument("--electron-zip", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--app-source", type=Path, required=True)
    parser.add_argument("--web-root", type=Path, required=True)
    parser.add_argument("--icon", type=Path, required=True)
    args = parser.parse_args()
    package(args.electron_zip, args.output, args.app_source, args.web_root, args.icon)


if __name__ == "__main__":
    main()
