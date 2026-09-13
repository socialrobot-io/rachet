import copy
import tempfile
import unittest
from pathlib import Path

from scripts.check_repo import ROOT, check_lock, check_markdown, check_sequence, read_json
from scripts.install_reflow_skill import install


class SequenceChecks(unittest.TestCase):
    def setUp(self):
        self.sequence = read_json(ROOT / "examples/onboarding.sequence.json")

    def test_example_is_valid(self):
        check_sequence(self.sequence)

    def test_rejects_broken_graphs(self):
        mutations = [
            lambda s: s["steps"].append(copy.deepcopy(s["steps"][0])),
            lambda s: s["steps"][0].update(next="absent"),
            lambda s: s["steps"][0].update(next="welcome"),
            lambda s: s["steps"].append({"id": "unused", "type": "end", "reason": "unused"}),
            lambda s: s.update(entryStepId="absent"),
            lambda s: s["steps"][1].pop("timeout"),
            lambda s: s["steps"][-1].update(next="welcome"),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                value = copy.deepcopy(self.sequence)
                mutate(value)
                with self.assertRaises(ValueError):
                    check_sequence(value)

    def test_wait_and_branch(self):
        sequence = {"schemaVersion": "1", "entryStepId": "wait", "steps": [
            {"id": "wait", "type": "wait", "duration": "P1D", "next": "branch"},
            {"id": "branch", "type": "branch", "branches": [
                {"when": {"exists": "activation"}, "next": "end"}], "default": "end"},
            {"id": "end", "type": "end", "reason": "done"}]}
        check_sequence(sequence)
        sequence["steps"][0]["until"] = "2026-10-01T00:00:00Z"
        with self.assertRaises(ValueError):
            check_sequence(sequence)


class RepositoryChecks(unittest.TestCase):
    def test_markdown_rejects_broken_link_and_fence(self):
        with tempfile.TemporaryDirectory() as directory:
            page = Path(directory) / "page.md"
            for content in ("[missing](missing.md)\n", "```json\n{}\n"):
                page.write_text(content)
                with self.assertRaises(ValueError):
                    check_markdown(page)
            page.write_text("```text\n[example](not-a-link.md)\n```\n")
            check_markdown(page)

    def test_json_duplicate_keys_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "data.json"
            path.write_text('{"a": 1, "a": 2}')
            with self.assertRaises(ValueError):
                read_json(path)

    def test_unpinned_skill_rejected(self):
        lock = read_json(ROOT / "skills.lock.json")
        check_lock(lock)
        lock["skills"][0]["revision"] = "main"
        with self.assertRaises(ValueError):
            check_lock(lock)

    def test_skill_install_preserves_local_modifications(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source.mkdir()
            (source / "SKILL.md").write_text("original\n")
            destination = root / "installed/reflow"
            self.assertEqual(install(source, destination), "Installed")
            self.assertEqual(install(source, destination), "Already installed (identical)")
            (destination / "SKILL.md").write_text("user modification\n")
            with self.assertRaises(ValueError):
                install(source, destination)
            self.assertEqual((destination / "SKILL.md").read_text(), "user modification\n")


if __name__ == "__main__":
    unittest.main()
