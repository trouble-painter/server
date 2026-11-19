# Deploy to the server (script lives in the private .env repo)
deploy-dev:
	bash .env/deploy/deploy.sh dev

deploy-prod:
	bash .env/deploy/deploy.sh prod

.PHONY: deploy-dev deploy-prod
