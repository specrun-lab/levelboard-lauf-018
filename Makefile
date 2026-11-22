# Levelboard – Makefile (feste Befehle, siehe spec/03-architektur.md)

CURDIR ?= $(shell pwd)

RUN_ID ?= lokal
GITHUB_REPO ?= specrun-lab/levelboard-$(RUN_ID)
LIVE_DOMAIN ?=
LIVE_URL ?= https://$(RUN_ID).$(LIVE_DOMAIN)
URL ?= http://127.0.0.1:8080
API_URL ?= http://127.0.0.1:8081

.PHONY: down level1 level2 level3 level4 level5 level6 level7 level8 level9 level10 \
	check restart-backend stop-backend

define wait_http
	@ok=0; for i in $$(seq 1 60); do \
		if curl -sf -o /dev/null $(1); then ok=1; break; fi; \
		sleep 1; \
	done; \
	if [ "$$ok" != "1" ]; then \
		echo "Wartezeit überschritten für $(1)"; \
		ls -la .run/ 2>/dev/null; \
		for l in .run/*.log; do echo "--- $$l ---"; cat "$$l" 2>/dev/null; done; \
		exit 1; \
	fi
endef

down:
	@for f in frontend.pid nginx.pid backend.pid; do \
		if [ -f .run/$$f ]; then \
			pid=$$(cat .run/$$f); \
			kill $$pid 2>/dev/null || true; \
			for i in $$(seq 1 50); do kill -0 $$pid 2>/dev/null || break; sleep 0.1; done; \
			kill -9 $$pid 2>/dev/null || true; \
			rm -f .run/$$f; \
		fi; \
	done; \
	rm -f .run/level; \
	true

stop-backend:
	@if [ -f .run/backend.pid ]; then \
		pid=$$(cat .run/backend.pid); \
		kill $$pid 2>/dev/null || true; \
		for i in $$(seq 1 50); do kill -0 $$pid 2>/dev/null || break; sleep 0.1; done; \
		kill -9 $$pid 2>/dev/null || true; \
		rm -f .run/backend.pid; \
	fi; \
	true

restart-backend:
	@if [ -f .run/backend.pid ]; then \
		pid=$$(cat .run/backend.pid); \
		kill $$pid 2>/dev/null || true; \
		for i in $$(seq 1 50); do kill -0 $$pid 2>/dev/null || break; sleep 0.1; done; \
		kill -9 $$pid 2>/dev/null || true; \
		rm -f .run/backend.pid; \
	fi
	@(LEVELBOARD_DB=.run/levelboard.db ./backend/bin/levelboard-backend < /dev/null >> .run/backend.log 2>&1 & echo $$! > .run/backend.pid)
	@$(call wait_http,$(API_URL)/api/health)
	@echo "Backend neu gestartet (Datenbank erhalten)"

level1:
	@$(MAKE) --no-print-directory down
	@mkdir -p .run
	@cd frontend && npm ci && npm run build
	@cd frontend && (./node_modules/.bin/vite preview < /dev/null > ../.run/frontend.log 2>&1 & echo $$! > ../.run/frontend.pid)
	@echo 1 > .run/level
	@$(call wait_http,$(URL)/)
	@echo "Levelboard läuft auf $(URL)"

level2:
	@$(MAKE) --no-print-directory down
	@mkdir -p .run .run/nginx-tmp
	@cd frontend && npm ci && npm run build
	@nginx -p "$(CURDIR)/" -e .run/nginx-error.log -c frontend/nginx.conf
	@echo 2 > .run/level
	@$(call wait_http,$(URL)/)
	@echo "Levelboard läuft auf $(URL)"

level3:
	@$(MAKE) --no-print-directory down
	@mkdir -p .run .run/nginx-tmp
	@cd frontend && npm ci && npm run build
	@cd backend && go build -o bin/levelboard-backend .
	@rm -f .run/levelboard.db .run/levelboard.db-wal .run/levelboard.db-shm
	@nginx -p "$(CURDIR)/" -e .run/nginx-error.log -c frontend/nginx.conf
	@(LEVELBOARD_DB=.run/levelboard.db ./backend/bin/levelboard-backend < /dev/null >> .run/backend.log 2>&1 & echo $$! > .run/backend.pid)
	@echo 3 > .run/level
	@$(call wait_http,$(URL)/)
	@$(call wait_http,$(API_URL)/api/health)
	@echo "Levelboard läuft auf $(URL)"
	@echo "Backend läuft auf $(API_URL)"

level4:
	@$(MAKE) --no-print-directory down
	@mkdir -p .run .run/nginx-tmp
	@cd frontend && npm ci && npm run build
	@cd backend && go build -o bin/levelboard-backend .
	@rm -f .run/levelboard.db .run/levelboard.db-wal .run/levelboard.db-shm
	@nginx -p "$(CURDIR)/" -e .run/nginx-error.log -c frontend/nginx.conf
	@(LEVELBOARD_DB=.run/levelboard.db ./backend/bin/levelboard-backend < /dev/null >> .run/backend.log 2>&1 & echo $$! > .run/backend.pid)
	@echo 4 > .run/level
	@$(call wait_http,$(URL)/)
	@$(call wait_http,$(API_URL)/api/health)
	@echo "Levelboard läuft auf $(URL)"
	@echo "Backend läuft auf $(API_URL)"
	@echo "Datenbank: .run/levelboard.db"

level5:
	@$(MAKE) --no-print-directory down
	@mkdir -p .run .run/nginx-tmp
	@cd frontend && npm ci && npm run build
	@cd backend && go build -o bin/levelboard-backend .
	@rm -f .run/levelboard.db .run/levelboard.db-wal .run/levelboard.db-shm
	@nginx -p "$(CURDIR)/" -e .run/nginx-error.log -c frontend/nginx-api.conf
	@(LEVELBOARD_DB=.run/levelboard.db ./backend/bin/levelboard-backend < /dev/null >> .run/backend.log 2>&1 & echo $$! > .run/backend.pid)
	@printf '{"source":"api"}' > frontend/dist/config.json
	@echo 5 > .run/level
	@$(call wait_http,$(URL)/api/health)
	@echo "Levelboard läuft auf $(URL) (Quelle: Backend)"
	@echo "Backend läuft auf $(API_URL)"
	@echo "Datenbank: .run/levelboard.db"

level6:
	@$(MAKE) --no-print-directory down
	@mkdir -p .run .run/nginx-tmp
	@cd frontend && npm ci && npm run build
	@cd backend && go build -o bin/levelboard-backend .
	@rm -f .run/levelboard.db .run/levelboard.db-wal .run/levelboard.db-shm
	@nginx -p "$(CURDIR)/" -e .run/nginx-error.log -c frontend/nginx-api.conf
	@(LEVELBOARD_DB=.run/levelboard.db ./backend/bin/levelboard-backend < /dev/null >> .run/backend.log 2>&1 & echo $$! > .run/backend.pid)
	@printf '{"source":"api"}' > frontend/dist/config.json
	@echo 6 > .run/level
	@$(call wait_http,$(URL)/api/health)
	@echo "Levelboard läuft auf $(URL) (Quelle: Backend)"
	@echo "Backend läuft auf $(API_URL)"
	@echo "Datenbank: .run/levelboard.db"
	@echo "Repo: https://github.com/$(GITHUB_REPO)"

level7:
	@$(MAKE) --no-print-directory down
	@mkdir -p .run .run/nginx-tmp
	@cd frontend && npm ci && npm run build
	@cd backend && go build -o bin/levelboard-backend .
	@rm -f .run/levelboard.db .run/levelboard.db-wal .run/levelboard.db-shm
	@nginx -p "$(CURDIR)/" -e .run/nginx-error.log -c frontend/nginx-api.conf
	@(LEVELBOARD_DB=.run/levelboard.db ./backend/bin/levelboard-backend < /dev/null >> .run/backend.log 2>&1 & echo $$! > .run/backend.pid)
	@printf '{"source":"api"}' > frontend/dist/config.json
	@echo 7 > .run/level
	@$(call wait_http,$(URL)/api/health)
	@echo "Levelboard läuft auf $(URL) (Quelle: Backend)"
	@echo "Backend läuft auf $(API_URL)"
	@echo "Datenbank: .run/levelboard.db"
	@echo "Repo: https://github.com/$(GITHUB_REPO)"
	@echo "Images: ghcr.io/$(GITHUB_REPO)-frontend und ghcr.io/$(GITHUB_REPO)-backend"

level8:
	@$(MAKE) --no-print-directory down
	@mkdir -p .run .run/nginx-tmp
	@cd frontend && npm ci && npm run build
	@cd backend && go build -o bin/levelboard-backend .
	@rm -f .run/levelboard.db .run/levelboard.db-wal .run/levelboard.db-shm
	@nginx -p "$(CURDIR)/" -e .run/nginx-error.log -c frontend/nginx-api.conf
	@(LEVELBOARD_DB=.run/levelboard.db ./backend/bin/levelboard-backend < /dev/null >> .run/backend.log 2>&1 & echo $$! > .run/backend.pid)
	@printf '{"source":"api"}' > frontend/dist/config.json
	@echo 8 > .run/level
	@$(call wait_http,$(URL)/api/health)
	@echo "Levelboard läuft auf $(URL) (Quelle: Backend)"
	@echo "Backend läuft auf $(API_URL)"
	@echo "Datenbank: .run/levelboard.db"
	@echo "Repo: https://github.com/$(GITHUB_REPO)"
	@echo "Images: ghcr.io/$(GITHUB_REPO)-frontend und ghcr.io/$(GITHUB_REPO)-backend"
	@echo "Live: $(LIVE_URL)"

level9:
	@$(MAKE) --no-print-directory down
	@mkdir -p .run .run/nginx-tmp
	@cd frontend && npm ci && npm run build
	@cd backend && go build -o bin/levelboard-backend .
	@rm -f .run/levelboard.db .run/levelboard.db-wal .run/levelboard.db-shm
	@nginx -p "$(CURDIR)/" -e .run/nginx-error.log -c frontend/nginx-api.conf
	@(LEVELBOARD_DB=.run/levelboard.db ./backend/bin/levelboard-backend < /dev/null >> .run/backend.log 2>&1 & echo $$! > .run/backend.pid)
	@printf '{"source":"api"}' > frontend/dist/config.json
	@echo 9 > .run/level
	@$(call wait_http,$(URL)/api/health)
	@echo "Levelboard läuft auf $(URL) (Quelle: Backend)"
	@echo "Backend läuft auf $(API_URL)"
	@echo "Datenbank: .run/levelboard.db"
	@echo "Repo: https://github.com/$(GITHUB_REPO)"
	@echo "Images: ghcr.io/$(GITHUB_REPO)-frontend und ghcr.io/$(GITHUB_REPO)-backend"
	@echo "Live: $(LIVE_URL)"
	@echo "Live-Prüfung gegen $(LIVE_URL)"

level10:
	@$(MAKE) --no-print-directory down
	@mkdir -p .run .run/nginx-tmp
	@cd frontend && npm ci && npm run build
	@cd backend && go build -o bin/levelboard-backend .
	@rm -f .run/levelboard.db .run/levelboard.db-wal .run/levelboard.db-shm
	@nginx -p "$(CURDIR)/" -e .run/nginx-error.log -c frontend/nginx-api.conf
	@(LEVELBOARD_DB=.run/levelboard.db ./backend/bin/levelboard-backend < /dev/null >> .run/backend.log 2>&1 & echo $$! > .run/backend.pid)
	@printf '{"source":"api"}' > frontend/dist/config.json
	@echo 10 > .run/level
	@$(call wait_http,$(URL)/api/health)
	@echo "Levelboard läuft auf $(URL) (Quelle: Backend)"
	@echo "Backend läuft auf $(API_URL)"
	@echo "Datenbank: .run/levelboard.db"
	@echo "Repo: https://github.com/$(GITHUB_REPO)"
	@echo "Images: ghcr.io/$(GITHUB_REPO)-frontend und ghcr.io/$(GITHUB_REPO)-backend"
	@echo "Live: $(LIVE_URL)"
	@echo "Live-Prüfung gegen $(LIVE_URL)"
	@echo "Abschlussbericht: $(LIVE_URL)"

check:
	@LEVEL=$$(cat .run/level 2>/dev/null || echo 10); \
	echo "Prüfe Levels 1 bis $$LEVEL"; \
	if [ ! -d checks/node_modules ]; then (cd checks && npm ci); fi; \
	(cd checks && npx playwright install chromium); \
	rm -f checks/.out/loadtest.json; \
	FILES=""; ARGS=""; \
	for i in $$(seq 1 $$LEVEL); do FILES="$$FILES tests/level$$i.spec.ts"; ARGS="$$ARGS $$i"; done; \
	(cd checks && BASE_URL=$(URL) API_URL=$(API_URL) GITHUB_REPO=$(GITHUB_REPO) LIVE_URL=$(LIVE_URL) RUN_ID=$(RUN_ID) npx playwright test $$FILES); \
	PW_EXIT=$$?; \
	WR_ENV="GITHUB_REPO=$(GITHUB_REPO) RUN_ID=$(RUN_ID)"; \
	if [ $$LEVEL -ge 5 ]; then WR_ENV="$$WR_ENV REPORT_API=1 API_URL=$(API_URL)"; fi; \
	if [ $$LEVEL -ge 9 ]; then WR_ENV="$$WR_ENV REPORT_LIVE=1 LIVE_URL=$(LIVE_URL)"; fi; \
	(cd checks && env $$WR_ENV node write-results.mjs $$ARGS); \
	WR_EXIT=$$?; \
	FINAL=$$PW_EXIT; \
	if [ $$WR_EXIT -ne 0 ]; then FINAL=1; fi; \
	if [ $$LEVEL -ge 10 ] && [ $$WR_EXIT -eq 0 ]; then \
		(cd checks && LIVE_URL=$(LIVE_URL) RUN_ID=$(RUN_ID) npx playwright test tests/live-report.spec.ts --reporter=list); \
		LR_EXIT=$$?; \
		if [ $$LR_EXIT -ne 0 ]; then FINAL=1; fi; \
	fi; \
	exit $$FINAL
