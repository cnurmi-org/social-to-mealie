.PHONY: help init build test lint run check deploy

help:
	@printf '%s\n' \
		'social-to-mealie' \
		'  make init    - install Node dependencies with pnpm' \
		'  make build   - build the Next.js app' \
		'  make test    - no automated test suite is configured' \
		'  make lint    - run Biome lint' \
		'  make run     - start the local dev server' \
		'  make check   - run lint and production build' \
		'  make deploy  - sync deploy/service.yml into the homeserver repo'

init:
	corepack enable
	pnpm install --frozen-lockfile
	@if [ ! -f .env ] && [ -f .env.example ]; then cp .env.example .env; fi

build:
	pnpm build

test:
	@echo 'No automated test suite is configured for this repo.'

lint:
	pnpm lint

run:
	pnpm dev

check: lint build

deploy:
	./deploy/register.sh /home/cnurmi/repo/homeserver
	@echo 'Next: commit homeserver changes, push, then restart the service on mediasrv.'
