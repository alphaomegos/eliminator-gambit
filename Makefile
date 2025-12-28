COMPOSE ?= docker compose
ITEST_PROJECT ?= eg_test

up:
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f --tail=200

psql:
	$(COMPOSE) exec db psql -U eliminator -d eliminator

restart:
	$(COMPOSE) restart

# Unit tests (no DB)
test:
	$(COMPOSE) run --rm --no-deps api pytest -q -c app/pytest.ini -m unit app/tests

# Integration tests (separate compose project + separate Postgres volume)
itest:
	$(COMPOSE) -p $(ITEST_PROJECT) -f docker-compose.test.yml up -d test-db || true
	$(COMPOSE) -p $(ITEST_PROJECT) -f docker-compose.test.yml run --rm test
	$(COMPOSE) -p $(ITEST_PROJECT) -f docker-compose.test.yml down -v 2>/dev/null || true


ci: test itest

.PHONY: up down logs psql restart test itest ci
