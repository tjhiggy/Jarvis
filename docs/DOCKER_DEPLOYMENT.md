# Docker deployment evaluation

Docker is a controlled deployment experiment for Jarvis, not an automatic
replacement for the native Windows launch path. Never run both deployments
with the same Discord token.

## Current guardrails

- The container runs as non-root with a read-only root filesystem.
- SQLite is stored only in the named `jarvis-data` volume.
- The service is limited to 768 MB memory and 1.5 CPUs.
- Ollama remains on the Windows host and is reached through
  `host.docker.internal` when explicitly configured.
- Native Windows remains the rollback path.

## Evaluation checklist

1. Stop native Jarvis.
2. Back up the native SQLite database.
3. Build and start the compose service from the release checkout.
4. Verify the container health state, `/status`, a mention, one scheduler
   smoke test, and SQLite persistence across recreation.
5. Observe memory and latency before deciding whether Docker Desktop is viable.
6. Stop the container and restore the native deployment if any instability
   appears.

Do not treat a successful image build as production approval. Record the
observation window, backup path, smoke-test evidence, and rollback result in
the release enablement checklist.
