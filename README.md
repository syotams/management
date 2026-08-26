# Task Manager

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

```bash
git clone <your-repo-url> management
cd management
cp .env.example .env
# Edit .env: set strong passwords, JWT_SECRET, and APP_URL / CORS_ORIGIN
# to http://YOUR_DROPLET_IP (or your domain)

docker compose up -d --build
```

Open `http://YOUR_DROPLET_IP`. Local development still uses SQLite; only the Compose stack uses MySQL.

Useful commands:

```bash
docker compose logs -f
docker compose ps
docker compose down
```

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
