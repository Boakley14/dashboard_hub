# 10 Federal — Dashboard Hub

A lightweight, branded web portal for publishing and browsing AI-generated `.html` dashboards.
Live at: **https://boakley14.github.io/dashboard_hub/**

---

## How It Works

1. Drop an `.html` dashboard file into `dashboards/`
2. Add one entry to `dashboards/dashboards.json`
3. Push to GitHub → card appears on the live hub in ~60 seconds

See [`docs/HOW-TO-ADD-DASHBOARD.md`](docs/HOW-TO-ADD-DASHBOARD.md) for the full non-developer guide.

---

## Project Structure

```
10Fed-Dashboard-Hub/
├── index.html              # Hub home — card grid, search, category filters
├── viewer.html             # Dashboard viewer — embedded iframe
├── dashboards/
│   ├── dashboards.json     # Central registry — ONE entry per dashboard
│   ├── thumbnails/         # Optional PNG preview images
│   └── [.html files]       # Drop dashboard files here
├── src/
│   ├── app.js              # Hub page orchestrator
│   ├── viewer.js           # Viewer page orchestrator
│   └── modules/
│       ├── registry.js     # Loads & caches dashboards.json
│       ├── cards.js        # Renders dashboard cards
│       ├── filters.js      # Search & category filter logic
│       ├── iframe.js       # iframe mounting & error handling
│       ├── router.js       # URL query string helpers
│       └── ui.js           # Shared DOM helpers
├── assets/
│   ├── css/
│   │   ├── tokens.css      # 10 Federal brand design tokens
│   │   ├── main.css        # Hub page styles
│   │   └── viewer.css      # Viewer page styles
│   └── img/                # Logo files
└── docs/
    └── HOW-TO-ADD-DASHBOARD.md
```

---

## Local Development

Requires a simple HTTP server (not `file://` — browsers block `fetch()` locally).

**Option A — VS Code Live Server**
Install the [Live Server extension](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer), open the project folder in VS Code, and click **Go Live** in the bottom status bar.

**Option B — Python**
```bash
cd 10Fed-Dashboard-Hub
python -m http.server 8080
# Open http://localhost:8080
```

---

## GitHub Pages Setup (one-time)

1. Go to repo **Settings → Pages**
2. Source: `main` branch, `/ (root)` folder
3. Save → live at `https://boakley14.github.io/dashboard_hub/`

---

## Maintained by
10 Federal — Brian Oakley (boakley@10federal.com)
