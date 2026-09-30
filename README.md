# SprintPulse

A full-stack task management application with teams, assignments, drag-and-drop scheduling, comments, audit history, and alerts.

## Features

- **Auth**: Register/login with email + password (unique email enforcement)
- **Teams**: Create teams, invite members (5-day expiry), copy invite links, remove members
- **Tasks**: Grouped by day (Overdue → Today → future), sorted by priority
- **Inline add**: Title required; defaults: due today, priority medium, assignee self
- **Actions**: Start, Complete, Postpone (owner only), Archive
- **Drag & drop**: Move tasks between days (owner only) to change due date
- **Comments**: Thread on task detail; last comment visible in list
- **History**: Full audit log of all task changes
- **Alerts**: Configurable alert datetime; email (console) + browser notifications

## Tech Stack

- **Frontend**: Angular 20, Bootstrap 5, Angular CDK (drag-drop)
- **Backend**: NestJS 10, Prisma 5
- **Database**: SQLite (local development), MySQL 8 (Docker production)
- **Auth**: JWT
- **Production**: Docker Compose (MySQL + NestJS + Nginx)

## Getting Started

### Backend

```bash
cd backend
npm install
npx prisma db push
npm start
```

Backend runs at http://localhost:3000

### Frontend

```bash
cd frontend
npm install
npm start
```

Frontend runs at http://localhost:4200

### Local production-like check (Docker)

Before deploying, run the same MySQL + Nest + Nginx stack locally (migrations, `db push`, and the built frontend). No certbot.

```bash
./deploy/local-up.sh
```

Or manually:

```bash
cp .env.local.example .env.local
docker compose -f docker-compose.local.yml --env-file .env.local up -d --build
```

Open http://localhost:8080. MySQL is on `localhost:3307`.

```bash
docker compose -f docker-compose.local.yml --env-file .env.local logs -f backend
docker compose -f docker-compose.local.yml --env-file .env.local down       # keep DB
docker compose -f docker-compose.local.yml --env-file .env.local down -v    # wipe DB
```

## Production deploy (DigitalOcean droplet)

Designed for a small droplet (e.g. **1 vCPU / 512 MB RAM**). MySQL is memory-capped; add swap before the first build.

### 1. Create swap (required on 512 MB)

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 2. Install Docker

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER
# log out and back in so the docker group applies
```

### 3. Configure and start

On the droplet, create the deployment folder and its `.env` (copy the contents of `.env.example` from this repo):

```bash
mkdir -p /home/deploy/management
nano /home/deploy/management/.env
# Set strong passwords, JWT_SECRET, CERTBOT_EMAIL,
# and APP_URL / CORS_ORIGIN to https://sp.matheager.com
```

Then, from your machine, run `./deploy/release.sh` (see [Releasing](#4-releasing)). It ships the images and starts the stack.

Point a DNS **A record** for `sp.matheager.com` at the droplet IP, and open **ports 80 and 443**. Let's Encrypt then issues a free certificate and renews it automatically (effectively free forever). Until the cert exists, the app stays available on HTTP.

Open `https://sp.matheager.com`. Local development still uses SQLite; only the Compose stack uses MySQL.

### Test SSL before production

Let's Encrypt will not issue a trusted cert for `localhost`. To verify nginx, HTTPS, the ACME path, and HTTP→HTTPS redirect locally:

```bash
./deploy/test-ssl.sh
```

On the droplet, you can issue an untrusted staging cert first (same flow as production, no rate-limit risk):

```bash
# in .env
CERTBOT_STAGING=1
docker compose up -d --no-build
docker compose logs -f certbot
```

When that works, set `CERTBOT_STAGING=0` and recreate the stack so a trusted cert is issued:

```bash
# in .env: CERTBOT_STAGING=0
docker compose up -d
```

If a staging cert is already on disk, certbot will replace it with a production cert automatically.

Useful commands (in `/home/deploy/management`):

```bash
docker compose logs -f
docker compose ps
docker compose down
```

The post-deploy checks require a trusted certificate, so a release fails (and rolls back) while the site is still HTTP-only or on a staging cert.

### 4. Releasing

Releases are built and tested on your machine, then shipped to the droplet with `./deploy/release.sh`. The droplet never builds and needs no git checkout.

```bash
cp .env.deploy.example .env.deploy   # set DEPLOY_HOST=deploy@<droplet-ip>
./deploy/release.sh
```

The script stops at the first failure. Nothing on the droplet changes until step 6.

1. **Preflight**: clean git tree (the release tag is the short commit sha), ssh access, droplet has `.env` and the old auto-update timer is off.
2. **Tests**: backend build, unit and e2e tests; frontend production build (and unit tests if any exist).
3. **Build** `management-backend:<sha>` and `management-nginx:<sha>` for linux/amd64.
4. **Container sanity**: starts a throwaway MySQL + backend + nginx stack from those images (ports 18080–18082) and runs `deploy/sanity.sh --full`: SPA and API reachable through nginx, register/login, task list create, task create/move, list delete with move-to.
5. **Ship**: `docker save | gzip | ssh docker load` (no registry), then syncs `docker-compose.yml` and `deploy/` helpers.
6. **Backup**: `mysqldump` into `backups/` (last 5 kept).
7. **Swap**: retags the new images as `:current` and runs `docker compose up -d --no-build`.
8. **Production checks**: `deploy/sanity.sh --readonly https://sp.matheager.com` (HTTPS certificate, HTTP→HTTPS redirect, SPA, API). If `SANITY_EMAIL`/`SANITY_PASSWORD` are set in `.env.deploy`, it also logs in and reads tasks. On failure it switches back to the previous release automatically.
9. **Record** the release in `releases.log` and prune old images (current + 2 previous are kept).

Options:

```bash
./deploy/release.sh --no-deploy                 # steps 1–4 only, droplet untouched
./deploy/release.sh --no-deploy --allow-dirty   # same, with uncommitted changes
./deploy/release.sh --rollback                  # switch back to the previous release
```

Rollback swaps images only; it does not revert the database schema. To restore data, use a backup:

```bash
cd /home/deploy/management
set -a; . ./.env; set +a
gunzip -c backups/management-<timestamp>.sql.gz \
  | docker compose exec -T mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"
```

#### Droplet layout

Everything lives under `/home/deploy/management` (the folder the stack already ran from):

```
/home/deploy/management/
  .env                 # production secrets (created once by you, never synced)
  docker-compose.yml   # synced by release.sh
  deploy/              # mysql config, certbot scripts, sanity.sh, remote.sh (synced)
  backups/             # mysqldump files
  releases.log         # one line per released tag
```

The compose project is pinned to `name: management`, so the existing `management_mysql_data` and `management_certbot_certs` volumes are always used.

#### One-time switch from the git-pull setup

On the droplet, turn off the hourly auto-update so it doesn't rebuild over released images:

```bash
sudo systemctl disable --now management-update.timer
```

Then run `./deploy/release.sh` from your machine. The folder, `.env`, volumes and mysql/certbot containers stay as they are; only the backend and nginx containers are replaced. The first rollback target is the old `:latest` images from the git-pull era. The git checkout can stay, but don't `git pull` + `docker compose up --build` there anymore.

`deploy/update.sh` and `deploy/install-auto-update.sh` are deprecated and kept only for reference.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /auth/register | Register |
| POST | /auth/login | Login |
| GET | /auth/me | Current user |
| POST | /teams | Create team |
| GET | /teams | List teams |
| GET | /teams/:id/members | Members + invites |
| POST | /teams/:id/invites | Send invite |
| DELETE | /teams/:id/members/:userId | Remove member |
| GET | /tasks | List active tasks |
| POST | /tasks | Create task |
| PATCH | /tasks/:id/start | Start task |
| PATCH | /tasks/:id/complete | Complete task |
| PATCH | /tasks/:id/archive | Archive task |
| PATCH | /tasks/:id/postpone | Change due date (owner only) |
| POST | /tasks/:id/comments | Add comment |
| GET | /tasks/:id/history | Audit log |

## Permissions

| Action | Owner | Assignee |
|--------|-------|----------|
| View, Start, Complete, Archive, Comment | ✓ | ✓ |
| Change due date (postpone/drag) | ✓ | ✗ |
| Set alert time | ✓ | ✗ |
