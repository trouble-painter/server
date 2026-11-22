# Run locally in watch mode; pick the environment interactively or pass ENV=<env>
run:
	bash scripts/run.sh $(ENV)

# Deploy to the server (script lives in the private .env repo)
deploy-dev:
	bash .env/deploy/deploy.sh dev

deploy-prod:
	bash .env/deploy/deploy.sh prod

# Install or update Prometheus, node_exporter and Grafana on the server
deploy-monitoring:
	bash .env/deploy/deploy-monitoring.sh

# Install or update the daily game history backup timer on the server
deploy-backup:
	bash .env/deploy/deploy-backup.sh

.PHONY: run deploy-dev deploy-prod deploy-monitoring deploy-backup
