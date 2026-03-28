# Dashboard Hub Hosting Architecture

## Purpose
Define the deployment and storage strategy for the Dashboard Hub.

## Hosting Platform
- Use Azure App Service to host the Dashboard Hub.
- The Hub will be a static front-end (primarily JavaScript, HTML, and CSS).

## Storage for Dashboards
- Use Azure Blob Storage to store user-uploaded HTML dashboards.
- Each dashboard will consist of:
  - The HTML file (the actual dashboard).
  - A JSON config file storing metadata (e.g., dashboard name, data source ID, categories, etc.).

## Blob Structure
- Create a container for dashboards.
- Each dashboard might have a unique folder (or naming pattern) containing:
  - `dashboard-name.html`
  - `dashboard-name.json`

## API or Upload Mechanism
- Provide a secure upload endpoint (likely an API or Azure Function) to handle file uploads.
- After upload, update a central dashboard registry (perhaps another JSON or table) to track available dashboards.

## Security & Access
- Ensure Blob Storage access is controlled (using SAS tokens or managed identities).
- Only allow authenticated users to upload or access dashboards.

## Relationships
- Azure App Service serves the main Hub UI and loads dashboards from Blob Storage.
- Dashboard metadata (JSON) will be used by the navigation module to populate the UI.
