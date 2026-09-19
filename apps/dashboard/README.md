# Reflow dashboard

One-column workflow operations console. Vite + React + Tailwind + [shadcn/ui](https://ui.shadcn.com).

## Run locally

```sh
pnpm dev:dashboard
```

Open http://localhost:5173. Vite proxies `/api` and `/v1` to the API.

## Stack

- Official [shadcn skill](https://skills.sh/shadcn/ui/shadcn)
- Components: Button, Card, Badge, Table, Progress, Breadcrumb, Select, Alert, Separator, Input, Label

## Screens

1. **Workflows** — narrow table of graphs + live enrolled counts
2. **Workflow** — one-column operational graph, then enrolled list
3. **Enrollment** — execution timeline (past / current card with progress / future), then enrollment meta, events, next
