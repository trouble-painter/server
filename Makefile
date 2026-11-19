# Run locally in watch mode; pick the environment interactively or pass ENV=<env>
run:
	bash scripts/run.sh $(ENV)

# Deploy to the server (script lives in the private .env repo)
deploy-dev:
	bash .env/deploy/deploy.sh dev

deploy-prod:
	bash .env/deploy/deploy.sh prod

.PHONY: run deploy-dev deploy-prod
