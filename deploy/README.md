# Deployment Configuration

This directory contains the Docker Compose service definition and deployment scripts for integrating this project with the homeserver stack.

## Files

- **service.yml** - Docker Compose service definition with Traefik labels
- **.env.example** - Template showing required Docker secrets
- **register.sh** - Script to register this service with homeserver compose

## Usage

### First-time registration

```bash
# From project root
./deploy/register.sh ~/repo/homeserver
```

This will:
1. Copy `service.yml` to `homeserver/compose/mediasrv/social-to-mealie.yml`
2. Add the service to `docker-compose-mediasrv.yml` include list (if not already there)
3. Check for required secrets and show warnings if missing

### After updating service.yml

Simply re-run the register script:

```bash
./deploy/register.sh ~/repo/homeserver
```

Then commit and push the homeserver repo changes.

## Deployment Workflow

1. **Make changes** to this project
2. **Update deploy/service.yml** if needed (ports, env vars, labels, etc.)
3. **Run register script** to sync changes to homeserver
4. **Commit in homeserver repo**:
   ```bash
   cd ~/repo/homeserver
   git diff  # review changes
   git add compose/mediasrv/social-to-mealie.yml
   git commit -m "Update social-to-mealie service config"
   git push origin main
   ```
5. **Deploy on mediasrv**:
   ```bash
   ssh mediasrv 'cd /home/cnurmi/docker && \
     git pull && \
     docker compose -f docker-compose-mediasrv.yml build social-to-mealie && \
     docker compose -f docker-compose-mediasrv.yml up -d social-to-mealie'
   ```

## Multi-Repo Architecture

This pattern solves the challenge of having project code in separate repos while maintaining centralized deployment configuration:

- **Project repo** (`social-to-mealie`) - Contains source code + `deploy/` folder
- **Homeserver repo** - Contains the central compose orchestration
- **register.sh** - Copies service definition from project → homeserver

This keeps project deployment config versioned with project code, while homeserver maintains the single source of truth for the deployed stack.
