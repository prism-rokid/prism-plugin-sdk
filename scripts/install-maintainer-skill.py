#!/usr/bin/env python3
"""将 SDK 维护 Skill 复制到插件仓库，不隐式覆盖已有定制。"""

import argparse
from pathlib import Path
import shutil
import sys


SKILL_NAME = "prism-plugin-maintainer"
SDK_ROOT = Path(__file__).resolve().parents[1]
SOURCE = SDK_ROOT / ".agents" / "skills" / SKILL_NAME


def install(target: Path, *, check: bool, update: bool) -> bool:
    """检查完整副本；仅在显式更新时覆盖不同的文件。"""
    target = target.expanduser().resolve()
    if not target.is_dir():
        raise ValueError(f"插件仓库目录不存在：{target}")
    destination = target / ".agents" / "skills" / SKILL_NAME
    for directory in (target / ".agents", destination.parent, destination):
        if directory.is_symlink():
            raise ValueError(f"目标 Skill 路径不能是符号链接：{directory}")
        if directory.exists() and not directory.is_dir():
            raise ValueError(f"目标路径不是目录：{directory}")

    source_files = sorted(path for path in SOURCE.rglob("*") if path.is_file())
    if not (SOURCE / "SKILL.md").is_file():
        raise ValueError(f"SDK Skill 源文件缺失：{SOURCE}")

    pending = []
    conflicts = []
    for source_file in source_files:
        relative = source_file.relative_to(SOURCE)
        output = destination / relative
        for component in (output, *output.parents):
            if component == destination:
                break
            if component.is_symlink():
                raise ValueError(f"目标 Skill 文件路径不能是符号链接：{component}")
            if component != output and component.exists() and not component.is_dir():
                raise ValueError(f"目标文件的父路径不是目录：{component}")
        if output.exists() and not output.is_file():
            raise ValueError(f"目标文件路径已被目录占用：{output}")
        if output.is_file() and output.read_bytes() == source_file.read_bytes():
            continue
        pending.append((source_file, output))
        if output.exists():
            conflicts.append(str(relative))

    if check:
        if pending:
            print(f"Skill 缺失或与 SDK 不一致：{target}")
            return False
        print(f"Skill 与 SDK 一致：{target}")
        return True
    if conflicts and not update:
        raise ValueError(
            f"保留已有定制，未写入 {target}；存在差异：{', '.join(conflicts)}。"
            "审阅后可用 --update 覆盖 SDK 管理的文件。"
        )
    for source_file, output in pending:
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_file, output)
    print(f"Skill 已就绪：{destination}（写入 {len(pending)} 个文件）")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("targets", nargs="+", type=Path, help="已有插件仓库目录")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="仅检查 SDK 文件副本，不写入")
    mode.add_argument("--update", action="store_true", help="覆盖有差异的 SDK 文件，保留额外文件")
    args = parser.parse_args()
    success = True
    for target in args.targets:
        try:
            success = install(target, check=args.check, update=args.update) and success
        except (OSError, ValueError) as error:
            print(f"安装 Skill 失败：{error}", file=sys.stderr)
            success = False
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
