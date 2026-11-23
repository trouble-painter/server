# Run locally in watch mode; pick the environment interactively or pass ENV=<env>
run:
	bash scripts/run.sh $(ENV)

# Deploy to the server (script lives in the private .env repo)
deploy-dev:
	bash .env/deploy/deploy.sh dev

deploy-prod:
	bash .env/deploy/deploy.sh prod

# Upload only .env/<env>/dev-uuids.txt (no restart); pass ENV=<dev|prod>
sync-dev-uuids:
	bash .env/deploy/sync-dev-uuids.sh $(ENV)

# Upload only .env/keywords after validating it (no restart); pass ENV=<dev|prod>
sync-keywords:
	bash .env/deploy/sync-keywords.sh $(ENV)

# Install or update Prometheus, node_exporter and Grafana on the server
deploy-monitoring:
	bash .env/deploy/deploy-monitoring.sh

# Install or update the daily game history backup timer on the server
deploy-backup:
	bash .env/deploy/deploy-backup.sh

.PHONY: run deploy-dev deploy-prod sync-dev-uuids sync-keywords deploy-monitoring deploy-backup
