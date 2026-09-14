.PHONY: check install-skill dev-infra dev-infra-down

check:
	python3 scripts/check_repo.py
	python3 -m unittest discover -s tests -v
	./node_modules/.bin/tsc --noEmit
	./node_modules/.bin/eslint .
	./node_modules/.bin/vitest run
	pnpm build
	@if docker compose version >/dev/null 2>&1; then \
		REFLOW_DOMAIN=reflow.example.test ACME_EMAIL=ops@example.test REFLOW_FROM=noreply@example.test docker compose -f compose.yaml config --quiet; \
		docker compose -f compose.dev.yaml config --quiet; \
	else echo "SKIP: Docker Compose plugin unavailable"; fi
	git diff --check
	git diff --cached --check

dev-infra:
	docker compose -f compose.dev.yaml up -d
	@echo "Waiting for Temporal namespace init..."
	@docker compose -f compose.dev.yaml wait temporal-namespace
	@echo "Infra ready: postgres :5433, temporal :7233, temporal UI :8080"

dev-infra-down:
	docker compose -f compose.dev.yaml down

install-skill:
	python3 scripts/install_reflow_skill.py
