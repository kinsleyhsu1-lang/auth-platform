.PHONY: dev test cleanup-test-users send-reset

dev:
	npm run dev

test:
	npm test

cleanup-test-users:
	./scripts/cleanup-test-users.sh

send-reset:
	@if [ -z "$(EMAIL)" ]; then echo "Usage: make send-reset EMAIL=user@example.com"; exit 1; fi
	./scripts/send-password-reset.sh $(EMAIL)
