#!/usr/bin/env python3
"""Validate Conventional Commit headers introduced by a pull request."""

from __future__ import annotations

import re
import subprocess
import sys


HEADER = re.compile(
    r"^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)"
    r"(?:\([a-z0-9][a-z0-9._/-]*\))?!?: .{1,62}\S$"
)


def validate_commit_messages(base: str, head: str) -> int:
    result = subprocess.run(
        ["git", "log", "--no-merges", "--format=%s", f"{base}..{head}"],
        check=True,
        capture_output=True,
        text=True,
    )
    messages = result.stdout.splitlines()
    if not messages:
        raise ValueError("The pull request must contain at least one non-merge commit.")

    invalid = [
        message for message in messages
        if len(message) > 72 or message.endswith(".") or not HEADER.fullmatch(message)
    ]
    if invalid:
        details = "\n".join(f"  {message}" for message in invalid)
        raise ValueError(
            "Invalid commit message headers (use Conventional Commits, max 72 characters):\n"
            f"{details}\nExample: docs(release): format notes and require commit headers"
        )
    return len(messages)


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: check_commit_messages.py <base-revision> <head-revision>", file=sys.stderr)
        return 2

    base, head = sys.argv[1:]
    try:
        count = validate_commit_messages(base, head)
    except (ValueError, subprocess.CalledProcessError) as error:
        print(error, file=sys.stderr)
        return 1
    print(f"Validated {count} commit message header(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
