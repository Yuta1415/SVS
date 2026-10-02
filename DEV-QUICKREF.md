# SVS - Development Quick Reference

## 🚀 Quick Start

| Command | Description |
|---------|-------------|
| `run-svs.bat` | Full production build + start (recommended) |
| `start.bat` | Dev mode with auto-reload |
| `stop-svs.bat` | Stop and cleanup |
| `rebuild.bat` | Rebuild all images |
| `health-check.bat` | Verify system is running |

## 🐛 VS Code Tasks

Press `Ctrl+Shift+P` → `Tasks: Run Task`:
- **SVS: Start** - Run run-svs.bat
- **SVS: Stop and Cleanup** - Run stop-svs.bat
- **SVS: Rebuild** - Run rebuild.bat
- **SVS: Health Check** - Run health-check.bat
- **SVS: View Logs** - Watch container logs
- **Backend: Test** - Run pytest in backend container

## 📝 URLs

| Service | URL |
|---------|-----|
| Frontend UI | http://127.0.0.1:3000 |
| API | http://127.0.0.1:8000 |
| Swagger Docs | http://127.0.0.1:8000/docs |
| API Health | http://127.0.0.1:8000/health |

## 🔧 Development Tips

### Hot Reload (dev mode)
When using `start.bat`, changes to `backend/` auto-reload. After editing `frontend/`, run:
```bash
docker compose exec frontend npm run build
```

### Backend Changes
Always rebuild for backend changes:
```bash
rebuild.bat
```

### Database Access
Direct access (when container is up):
```bash
docker compose exec db psql -U svs_user -d svs_database
```

### View Logs
```bash
docker compose logs -f
```

### Reset Everything
```bash
docker compose down -v
```

## 📦 Architecture

```
User → Frontend (3000) → Backend API (8000)
                    ↓
              Celery Worker
                    ↓
          Scanners (containers)
                    ↓
              PostgreSQL (db)
```

## 🧪 Testing

Run tests:
```bash
docker compose exec backend pytest -v
```

Run specific test:
```bash
docker compose exec backend pytest tests/test_scoring.py -v
```

## 🛑 Troubleshooting

### API not ready
```bash
docker compose logs backend
```

### Port already in use
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### Docker not running
Start Docker Desktop manually, then run `run-svs.bat`
