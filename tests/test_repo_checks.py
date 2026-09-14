import copy
import tempfile
import unittest
from pathlib import Path

from scripts.check_repo import ROOT, check_lock, check_markdown, check_workflow, read_json
from scripts.install_reflow_skill import install


class WorkflowChecks(unittest.TestCase):
    def setUp(self):
        self.sequence = read_json(ROOT / "examples/onboarding.workflow.json")

    def test_example_is_valid(self):
        check_workflow(self.sequence)

    def test_rejects_broken_graphs(self):
        mutations = [
            lambda s: s["nodes"].append(copy.deepcopy(s["nodes"][0])),
            lambda s: s["nodes"][0].update(next="absent"),
            lambda s: s["nodes"][0].update(next="welcome"),
            lambda s: s["nodes"].append({"id": "unused", "type": "end", "reason": "unused"}),
            lambda s: s.update(entryNodeId="absent"),
            lambda s: s["nodes"][1].pop("timeoutSeconds"),
            lambda s: s["nodes"][-1].update(next="welcome"),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                value = copy.deepcopy(self.sequence)
                mutate(value)
                with self.assertRaises(ValueError):
                    check_workflow(value)

    def test_wait_and_branch(self):
        sequence = {"schemaVersion": "1", "entryNodeId": "wait", "nodes": [
            {"id": "wait", "type": "delay", "durationSeconds": 86400, "next": "branch"},
            {"id": "branch", "type": "branch", "condition": {"op": "exists", "value": {"path": "contact.activation"}}, "onTrue": "end", "onFalse": "end"},
            {"id": "end", "type": "end", "reason": "done"}]}
        check_workflow(sequence)
        sequence["nodes"][0]["durationSeconds"] = 0
        with self.assertRaises(ValueError):
            check_workflow(sequence)


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
