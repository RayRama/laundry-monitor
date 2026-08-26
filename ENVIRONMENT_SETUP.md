# Environment Variables Setup

## Required Environment Variables

### For Local Development (.env.local)

```bash
# Smartlink API Configuration
UPSTREAM_BASE=https://owner-api.smartlink.id/masterData/meta
OUTLET_ID=OTL17503033412131
UPSTREAM_BEARER=your_bearer_token_here
UPSTREAM_TIMEOUT_MS=10000

# Dashboard Configuration
BEARER_TOKEN=your_bearer_token_here

# Development
NODE_ENV=development
PORT=3000
```

### For Vercel Deployment

Set these environment variables in Vercel dashboard:

```bash
UPSTREAM_BASE=https://owner-api.smartlink.id/masterData/meta
OUTLET_ID=OTL17503033412131
UPSTREAM_BEARER=your_bearer_token_here
BEARER_TOKEN=your_bearer_token_here
UPSTREAM_TIMEOUT_MS=10000
```


### Device snapshot safety net (optional but recommended)

```bash
# Shared secret for POST {EVENT_GATEWAY_BASE}/api/monitoring/device-snapshot.
# Must match MONITOR_INGEST_SECRET on laundry-monitor-gateway.
MONITOR_INGEST_SECRET=<same value as the gateway>
```

Smartlink randomly answers `list_snap_mesin` and `detail_snap_mesin` with a blank
placeholder `snap_report_device` — every field zeroed, `ol:false` included — for
machines that are perfectly healthy. Measured 2026-08-26 over five minutes: 16 of
24 machines hit a blank episode in BOTH endpoints at once, episodes ran up to 60
seconds, and not one machine in the outlet was actually offline.

Vercel gives each request a fresh lambda, so the monitor cannot remember the last
good record on its own. With this secret set it pushes good records to the gateway
each refresh and holds a machine at its last known state (with the countdown still
advancing) for up to 5 minutes while Smartlink is blank, instead of showing OFFLINE.

Without the secret the monitor still runs — it falls back to cross-checking blanks
against `detail_snap_mesin` only, which clears most but not all false OFFLINE.

## API Endpoints Structure

With the new `UPSTREAM_BASE` configuration, the following endpoints are constructed:

### Machine Data

- **Endpoint**: `${UPSTREAM_BASE}/list_snap_mesin`
- **Full URL**: `https://owner-api.smartlink.id/masterData/meta/list_snap_mesin`

### Transaction Summary

- **Endpoint**: `${UPSTREAM_BASE}/ringkasan_transaksi_snap_konsumen`
- **Full URL**: `https://owner-api.smartlink.id/masterData/meta/ringkasan_transaksi_snap_konsumen`

### Transaction List

- **Endpoint**: `${UPSTREAM_BASE}/list_transaksi_snap_konsumen`
- **Full URL**: `https://owner-api.smartlink.id/masterData/meta/list_transaksi_snap_konsumen`

## Migration from Old Configuration

### Before (Old)

```bash
UPSTREAM_BASE=https://owner-api.smartlink.id/masterData/meta/list_snap_mesin
```

### After (New)

```bash
UPSTREAM_BASE=https://owner-api.smartlink.id/masterData/meta
```

## Benefits of New Structure

1. **Modular**: Base URL can be reused for different services
2. **Flexible**: Easy to add new API endpoints
3. **Maintainable**: Single base URL to update
4. **Consistent**: All services use the same base configuration
