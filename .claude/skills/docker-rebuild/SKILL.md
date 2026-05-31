---
name: docker-rebuild
description: Rebuild biliLive-tools Docker containers, stream build logs, and verify deployment health. Use when user says "rebuild docker", "rebuild container", "docker rebuild", or "redeploy".
disable-model-invocation: true
---

# Docker Rebuild Skill

Rebuild the biliLive-tools API backend Docker image and restart containers.

## Workflow

### Step 1: Rebuild the API image

```bash
cd /home/hellrabbit/biliLive-tools && docker compose -f docker/docker-compose.yml build api --no-cache 2>&1
```

Use `run_in_background: true` for this long-running build. Monitor for errors.

### Step 2: Restart containers

```bash
cd /home/hellrabbit/biliLive-tools && docker compose -f docker/docker-compose.yml up -d api 2>&1
```

### Step 3: Health check

```bash
# Wait a few seconds then check
sleep 3 && docker compose -f docker/docker-compose.yml ps && echo "---" && docker compose -f docker/docker-compose.yml logs --tail=30 api 2>&1
```

### Step 4: Error scan

Scan logs for `[error]` patterns. If `BiliResponseError` found, check the structured log format:
`[BiliResponseError] code=<code> status=<status> <method> <path> message="<message>"`

## Notes

- The `--no-cache` flag ensures a clean rebuild
- Only the `api` service is rebuilt (not webui)
- Use `docker-compose-fullstack.yml` if fullstack mode is needed (`-f docker/docker-compose-fullstack.yml`)
