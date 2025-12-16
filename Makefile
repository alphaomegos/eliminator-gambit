up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f --tail=200

psql:
	docker compose exec db psql -U eliminator -d eliminator

restart:
	docker compose restart

.PHONY: up down logs psql restart

