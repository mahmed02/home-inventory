.PHONY: db-up db-down db-logs install migrate dev reset seed test smoke backup restore-drill

db-up:
	docker compose up -d postgres

db-down:
	docker compose down

db-logs:
	docker compose logs -f postgres

install:
	npm --prefix ./api ci

migrate:
	npm --prefix ./api run migrate

reset:
	npm --prefix ./api run db:reset

seed:
	npm --prefix ./api run db:seed

dev:
	npm --prefix ./api run dev

test:
	npm --prefix ./api test

smoke:
	./scripts/smoke.sh

backup:
	./scripts/backup.sh

restore-drill:
	./scripts/restore-drill.sh
