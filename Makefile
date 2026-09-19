.PHONY: check install-skill dev-infra dev-infra-down

check:
	pnpm check
	git diff --check
	git diff --cached --check

dev-infra:
	docker compose -f compose.dev.yaml up -d
	@echo "Waiting for Temporal namespace init..."
	@docker compose -f compose.dev.yaml run --rm temporal-namespace
	@echo "Infra ready: postgres :5433, temporal :7233, temporal UI :8080"

dev-infra-down:
	docker compose -f compose.dev.yaml down

install-skill:
	python3 scripts/install_reflow_skill.py
