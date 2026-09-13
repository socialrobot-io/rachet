.PHONY: check install-skill

check:
	python3 scripts/check_repo.py
	python3 -m unittest discover -s tests -v
	git diff --check
	git diff --cached --check

install-skill:
	python3 scripts/install_reflow_skill.py
