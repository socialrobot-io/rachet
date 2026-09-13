#!/usr/bin/env python3
"""Install the first-party skill without replacing a user's modified copy."""

import argparse
import hashlib
import os
import shutil
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "skills/reflow"


def fingerprint(folder):
    return {str(p.relative_to(folder)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in folder.rglob("*") if p.is_file()}


def install(source, destination):
    if destination.exists():
        if destination.is_dir() and fingerprint(source) == fingerprint(destination):
            return "Already installed (identical)"
        raise ValueError(f"Refusing to replace existing skill: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, destination)
    return "Installed"


def main():
    default = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))) / "skills"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest", type=Path, default=default, help="Destination skills root")
    args = parser.parse_args()
    destination = args.dest.expanduser().resolve() / "reflow"
    try:
        print(f"{install(SOURCE, destination)}: {destination}")
    except ValueError as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
