#!/usr/bin/env python3
"""Offline sanity checks for the specification repository, not a runtime validator."""

import json
import re
import subprocess
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path):
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f"Duplicate JSON key: {key}")
            result[key] = value
        return result

    return json.loads(path.read_text(), object_pairs_hook=unique_pairs)


def check_workflow(sequence):
    require(sequence.get("schemaVersion") == "1", "Unsupported workflow schema version")
    nodes = sequence.get("nodes", [])
    require(isinstance(nodes, list) and 0 < len(nodes) <= 100, "Expected 1–100 nodes")
    steps = {}
    for node in nodes:
        require(isinstance(node, dict), "Step must be an object")
        key = node.get("id")
        require(isinstance(key, str) and key, "Step ID required")
        require(key not in steps, f"Duplicate step ID: {key}")
        steps[key] = node
    edges = {}
    for key, node in steps.items():
        kind = node.get("type")
        require(kind in {"action", "delay", "wait_for_event", "branch", "end"}, f"Unknown node type: {kind}")
        if kind == "end":
            require(bool(node.get("reason")), f"End reason missing: {key}")
            require(not any(k in node for k in ("next", "onEvent", "onTimeout")),
                    f"End cannot have outgoing edges: {key}")
            edges[key] = []
        elif kind == "wait_for_event":
            for field in ("eventType", "timeoutSeconds", "onEvent", "onTimeout"):
                require(bool(node.get(field)), f"Missing {field}: {key}")
            edges[key] = [node["onEvent"], node["onTimeout"]]
        elif kind == "branch":
            require(node.get("condition") and node.get("onTrue") and node.get("onFalse"), f"Branch paths missing: {key}")
            edges[key] = [node["onTrue"], node["onFalse"]]
        else:
            require(bool(node.get("next")), f"Next step missing: {key}")
            if kind == "action":
                require(bool(node.get("action")) and isinstance(node.get("input"), dict), f"Action capability/input missing: {key}")
            if kind == "delay":
                require(isinstance(node.get("durationSeconds"), int) and node["durationSeconds"] > 0, f"Delay duration missing: {key}")
            edges[key] = [node["next"]]
        require(all(target in steps for target in edges[key]), f"Dangling edge: {key}")
    active, visited = set(), set()

    def visit(key):
        require(key in steps, "Missing entry step")
        require(key not in active, f"Cycle at {key}")
        if key in visited:
            return
        active.add(key)
        for target in edges[key]:
            visit(target)
        active.remove(key)
        visited.add(key)

    visit(sequence.get("entryNodeId"))
    require(visited == set(steps), "Unreachable steps")


def check_markdown(path):
    content = path.read_text()
    fence = None
    prose = []
    for line in content.splitlines():
        match = re.match(r"^\s*(`{3,}|~{3,})", line)
        if match:
            marker = match.group(1)
            if fence is None:
                fence = marker
            elif marker[0] == fence[0] and len(marker) >= len(fence):
                fence = None
            continue
        if fence is None:
            prose.append(line)
    require(fence is None, f"Unclosed code fence: {path}")
    for target in re.findall(r"\]\(([^\s)]+)\)", "\n".join(prose)):
        url = urlsplit(target.strip("<>"))
        if url.scheme or not url.path:
            continue
        destination = (path.parent / unquote(url.path)).resolve()
        require(destination.exists(), f"Broken local link: {path}: {target}")


def check_skill(folder):
    text = (folder / "SKILL.md").read_text()
    match = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    require(match is not None, f"Missing skill frontmatter: {folder}")
    # Our first-party metadata deliberately uses simple one-line string fields.
    fields = dict(line.split(": ", 1) for line in match[1].splitlines() if ": " in line)
    name = fields.get("name", "")
    require(re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name) is not None,
            "Invalid skill name")
    require(len(name) <= 64 and name == folder.name, "Skill name/folder mismatch")
    require(bool(fields.get("description")), "Skill description missing")
    for path in folder.rglob("*.md"):
        check_markdown(path)


def check_lock(lock):
    require(lock.get("version") == 1, "Unsupported skill lock version")
    names = set()
    for entry in lock["skills"]:
        require(entry["name"] not in names, "Duplicate locked skill")
        names.add(entry["name"])
        require(re.fullmatch(r"[0-9a-f]{40}", entry["revision"]) is not None,
                "Skills must pin full Git revisions")
        require(re.fullmatch(r"[\w.-]+/[\w.-]+", entry["repository"]) is not None,
                "Invalid GitHub repository")
        require(not Path(entry["path"]).is_absolute() and ".." not in Path(entry["path"]).parts,
                "Invalid skill path")


def main():
    required = ["README.md", "AGENTS.md", "CONTRIBUTING.md", "Makefile",
                "docs/PRD.md", "docs/ARCHITECTURE.md", "docs/AUTHENTICATION.md",
                "docs/OPERATIONS.md", "docs/SKILLS.md", "skills/reflow/SKILL.md"]
    for name in required:
        require((ROOT / name).is_file(), f"Required repository file missing: {name}")
    paths = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT
    ).decode().split("\0")
    for name in sorted(set(filter(None, paths))):
        path = ROOT / name
        if not path.is_file():
            continue
        require(path.name != ".env" and not name.startswith(("secrets/", "backups/", "data/")),
                f"Private runtime file included in repository: {name}")
        if path.suffix == ".md":
            check_markdown(path)
        if path.suffix == ".json":
            read_json(path)
        if path.suffix in {".md", ".py", ".yml"} or path.name == "Makefile":
            content = path.read_text()
            require(content.endswith("\n"), f"Missing final newline: {name}")
            require(not any(line.rstrip() != line for line in content.splitlines()),
                    f"Trailing whitespace: {name}")
            require(not re.search(r"^(<<<<<<< |=======\s*$|>>>>>>> )", content, re.M),
                    f"Merge conflict marker: {name}")
    check_lock(read_json(ROOT / "skills.lock.json"))
    check_skill(ROOT / "skills/reflow")
    for path in (ROOT / "examples").glob("*.workflow.json"):
        check_workflow(read_json(path))
    print("Repository checks passed: docs, links, JSON, graph, skill metadata, pinned sources, hygiene.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError) as error:
        raise SystemExit(f"Repository check failed: {error}")
