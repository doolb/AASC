# AASC WebBrowser

Standalone local browser-session service for Vivaldi and Chromium. It manages browser instances by CDP debug port, creates one native window per configured business, and creates one Tab per sub-business within that window.

## Start

```bash
npm install
npm start
```

The default configuration is `config.json`. Override it with:

```bash
npm start -- --config /path/to/config.json
```

The service listens on `127.0.0.1:3090` by default. It does not expose the control plane to the LAN unless the configured host is changed deliberately.

## Configuration

A browser definition selects a browser type, debug port, and optional persistent profile:

```json
{
  "browsers": {
    "main-ai": { "browser": "vivaldi", "debugPort": 9222 },
    "media": {
      "browser": "chromium",
      "debugPort": 9334,
      "profile": "/mnt/AASC/browser-profiles/media"
    }
  },
  "businesses": {
    "main-ai": { "browser": "main-ai" },
    "media": { "browser": "media" }
  }
}
```

On first use, an open debug port is attached without owning or shutting down that browser. A closed port starts the configured executable with the configured debug port. A configured profile is persistent and is never removed by service shutdown. The service never falls back to a different debug port. Each self-started profile may be owned by only one browser definition.

The shipped configuration contains `main-ai`, `special-ai`, `media`, and `daily` businesses. Multiple businesses may share a browser instance and its cookie environment while retaining separate native windows and queues.

## API and queues

The HTTP control API includes:

- `GET /api/status`
- `GET /api/browsers`
- `POST /api/browsers/:browserId/ensure`
- `GET /api/businesses`
- `POST /api/businesses/:businessId/ensure`
- `POST /api/businesses/:businessId/sub-businesses/:subId/ensure`
- `POST /api/businesses/:businessId/sub-businesses/:subId/navigate`
- `POST /api/businesses/:businessId/sub-businesses/:subId/action`
- `POST /api/businesses/:businessId/sub-businesses/:subId/activate`
- `GET /api/tasks/:taskId`
- `POST /api/shutdown`

Navigation and page actions return a `taskId`. All service actions for one business window share a FIFO queue; different business windows can run concurrently. `activate` is a service-managed Tab operation. Page actions are intended to remain standard CDP-compatible at the protocol boundary.

## CDP proxy

Discovery and WebSocket paths are browser-scoped:

```text
GET /cdp/:browserId/json/version
GET /cdp/:browserId/json/list
GET /cdp/:browserId/json/new
GET /cdp/:browserId/json/close/:targetId
WS  /cdp/:browserId/devtools/browser/:sessionId
WS  /cdp/:browserId/devtools/page/:targetId
```

Discovery responses rewrite only WebSocket endpoint URLs. CDP messages keep their original `id`, `method`, `params`, and `sessionId` fields. Commands for known business targets are submitted to that window queue; browser-level or unknown-target commands use the browser-level transport boundary. A client connecting directly to the original browser debug port bypasses this service's queues by design.

## X11 example

For a separately started Chromium instance, provide the operator-owned display and X11 authorization environment:

```bash
DISPLAY=:0 XAUTHORITY=/path/to/xauth \
  npm start -- --config /path/to/chromium-config.json
```

The service does not copy display credentials, elevate privileges, or terminate unrelated browser processes.
