# How to Add a Dashboard to the Hub

**You don't need to be a developer.** Follow these 3 steps and your dashboard will appear on the hub automatically.

---

## Step 1 — Drop Your File

Copy your `.html` dashboard file into the `dashboards/` folder in this project.

**Example:**
```
dashboards/
├── dashboards.json         ← don't touch this yet
├── quarterly-report.html   ← your new file goes here
└── ...
```

> **Tip:** Keep filenames lowercase with hyphens, no spaces.
> Good: `q1-2026-report.html`
> Avoid: `Q1 2026 Report (Final).html`

---

## Step 2 — Add an Entry to dashboards.json

Open `dashboards/dashboards.json` in any text editor (VS Code, Notepad, or GitHub's web editor).

It looks like a list of entries. **Copy one existing entry, paste it at the end of the list** (before the closing `]`), and add a comma after the previous entry.

Then fill in your details:

```json
{
  "id": "quarterly-report",
  "title": "Q1 2026 Quarterly Report",
  "description": "Portfolio performance summary for Q1 2026 across all properties.",
  "category": "Finance",
  "tags": ["quarterly", "finance", "2026"],
  "author": "Brian Oakley",
  "dateAdded": "2026-03-27",
  "filename": "quarterly-report.html",
  "thumbnail": "",
  "openInNewTab": false
}
```

### Field Reference

| Field | Required | Notes |
|-------|----------|-------|
| `id` | ✅ | Unique short name, no spaces (use hyphens). Must be different from every other id. |
| `title` | ✅ | Display name shown on the card |
| `description` | ✅ | One sentence shown on the card |
| `category` | ✅ | Any text — creates a filter pill automatically (e.g. Sales, Finance, Operations) |
| `tags` | Optional | List of keywords in quotes, separated by commas |
| `author` | Optional | Your name |
| `dateAdded` | Optional | Today's date in YYYY-MM-DD format |
| `filename` | ✅ | Exact filename of the .html file you dropped in Step 1 |
| `thumbnail` | Optional | Leave as `""` for an auto-colored placeholder. Or add a path to a PNG: `"thumbnails/my-screenshot.png"` |
| `openInNewTab` | Optional | Set to `true` if the dashboard has issues loading inside the hub. Default: `false` |

---

## Step 3 — Push to GitHub

Save `dashboards.json`, then commit and push both files to GitHub:

```bash
git add dashboards/quarterly-report.html dashboards/dashboards.json
git commit -m "Add Q1 2026 Quarterly Report dashboard"
git push
```

**That's it.** Within about 60 seconds, your new dashboard card will appear live on the hub at:
`https://boakley14.github.io/dashboard_hub/`

---

## Troubleshooting

**My card appears but the dashboard shows a blank iframe or error message.**
→ Open `dashboards.json` and set `"openInNewTab": true` for that entry. Save and push. The card will now open the dashboard directly in a new browser tab instead.

**I see "Dashboard Not Found" when I click the card.**
→ Check that the `filename` field in `dashboards.json` exactly matches the file you dropped in `dashboards/` — including uppercase/lowercase and the `.html` extension.

**My JSON has an error and the hub shows no cards.**
→ Paste the contents of `dashboards.json` into [jsonlint.com](https://jsonlint.com) to find the syntax error. Common issues: missing comma between entries, or a trailing comma after the last entry.
