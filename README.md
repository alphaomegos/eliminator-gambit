# The Eliminator’s Gambit

A digital party game of strategy and risk.

Two teams take turns eliminating options on-screen, trying to leave the single worst item (e.g., the lowest-rated movie).
One wrong tap—eliminating the target itself—ends the round instantly.

## Quick start

## ```bash
docker compose up -d --build

## CICD Pipeline

This project uses Jenkins for continuous deployment.

Pipeline flow:
1. Push to main branch
2. Jenkins pulls the code from GitHub
3. Builds Docker image
4. Redeploys the application automatically on AWS EC2

Tools used:
- Jenkins
- Docker
- AWS EC2
