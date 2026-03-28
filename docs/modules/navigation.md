# Dashboard Navigation Module

## Purpose
Provide an interface for users to browse, organize, and switch between dashboards.

## Inputs
- User preferences:
  - Default layout (left-hand menu or card view)
- Dashboard categories (e.g., "Operations," "Marketing")
- Dashboard metadata (names, IDs, icons)

## Outputs
- Renders navigation UI:
  - Collapsible left-hand menu (with categories)
  - Or card-based folder view (with categories)
- Triggers dashboard selection events

## Customization Options
- Default layout: "left menu" or "card view"
- Collapsible menu (on/off)
- Optional icons or thumbnail previews

## Relationships
- Connects to Dashboard Rendering Module (passes selected dashboard ID)
- Pulls data from Dashboard Metadata API
