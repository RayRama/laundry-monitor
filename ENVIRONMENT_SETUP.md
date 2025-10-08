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
