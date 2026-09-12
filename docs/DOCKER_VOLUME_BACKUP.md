# Docker volume backup and restore

`jarvis-data` is the only durable container state. It holds the SQLite
database and WAL companions. Treat a backup like production data. Do not copy
conversation rows, tokens, or unredacted logs into tickets.

The Compose project name is `jarvis`, so the volume name is
`jarvis_jarvis-data`. Confirm with `docker volume ls` before you archive.

## Back up

1. Stop the single replica so SQLite is consistent:

   ```bash
   docker compose stop jarvis
   ```

   Hosted overlay:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.hosted.yml stop jarvis
   ```

2. Archive the volume with `tar`, or snapshot the disk that holds Docker
   volumes using the host's approved snapshot tool.

   ```bash
   mkdir -p backups
   docker run --rm \
     --volume jarvis_jarvis-data:/volume:ro \
     --volume "$(pwd)/backups:/backup" \
     node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 \
     tar -C /volume -czf "/backup/jarvis-data-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" .
   ```

3. Start exactly one replica:

   ```bash
   docker compose up --detach
   ```

   Do not `--scale`. Do not start native Jarvis against the same token.

`docker compose down` keeps the volume. **`docker compose down --volumes`
deletes `jarvis-data` and is destructive.**

## Restore

1. Stop Jarvis.

2. Keep the current volume contents as incident evidence under approved
   controls if this is a recovery.

3. Replace the volume from the archive:

   ```bash
   docker run --rm \
     --volume jarvis_jarvis-data:/volume \
     --volume "$(pwd)/backups:/backup" \
     node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 \
     tar -C /volume -xzf /backup/jarvis-data-RESTORE.tar.gz
   ```

   Or restore the disk snapshot onto the volume's backing store.

4. Confirm the restored files are readable by `uid 10001`.

5. Start exactly one replica. Verify `/status`. A restore rolls SQLite state
   back to the backup point.

## Litestream (optional)

Litestream can replicate SQLite continuously to object storage. It is an extra,
not a requirement. Run **one writer only**: one Jarvis replica and at most one
Litestream process against that database. A second replica or a second
Litestream writer is unsafe. Restore still starts exactly one Jarvis replica
after the replica file is placed on `jarvis-data`.
