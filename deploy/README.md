# ARGUS deployment: Cloudflare Tunnel, origin firewall and cache rules

- **Status:** Ready for the Mini PC rollout
- **Applies to:** `apps/cdn` (origin `127.0.0.1:8080`) and `apps/web`
  (`127.0.0.1:3000`)
- **Out of scope:** WAF tuning and multi-origin failover

## 1. Topology

```
Browser / extension
        │ HTTPS
        ▼
Cloudflare edge (TLS terminated, cache rules)
        │ outbound-only tunnel
        ▼
cloudflared on the Mini PC
        │ http://127.0.0.1:8080  (CDN)
        │ http://127.0.0.1:3000  (app)
        ▼
ARGUS services bound to loopback only
```

Neither service publishes an inbound port. `cloudflared` makes outbound
connections to Cloudflare; the origin firewall denies everything except
loopback, established traffic, DNS and administrative SSH.

## 2. DNS records

Create these in the Cloudflare zone. Both are proxied (orange cloud), because
a tunnel hostname must resolve through Cloudflare.

| Type | Name | Target | Proxy | Purpose |
| --- | --- | --- | --- | --- |
| CNAME | `cdn` | `<TUNNEL_ID>.cfargotunnel.com` | Proxied | Read-only CDN hostname |
| CNAME | `app` | `<TUNNEL_ID>.cfargotunnel.com` | Proxied | Dashboard, canvas and API hostname |

`cloudflared tunnel route dns argus cdn.argus.example.com` creates the first
record automatically; repeat for `app`. Replace `argus.example.com` with the
real zone.

Set `CDN_BASE_URL=https://cdn.argus.example.com` in `apps/web/.env.local` and
in the extension settings so generated asset URLs use the public HTTPS origin,
not the loopback address.

## 3. Tunnel configuration

### Recommended: token-managed tunnel

1. Cloudflare dashboard → Zero Trust → Networks → Tunnels → **Create a
   tunnel** → Cloudflared.
2. Copy the tunnel token.
3. Install `cloudflared` on the Mini PC.
4. Store the token outside the repo:

   ```bash
   sudo install -d -m 700 /etc/argus
   sudo install -m 600 -o root -g root deploy/cloudflared/cloudflared.env.example \
     /etc/argus/cloudflared.env
   sudoedit /etc/argus/cloudflared.env   # replace TUNNEL_TOKEN
   ```

5. Install the unit and start it:

   ```bash
   sudo install -m 644 deploy/cloudflared/argus-tunnel.service \
     /etc/systemd/system/argus-tunnel.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now argus-tunnel
   sudo systemctl status argus-tunnel
   ```

6. Add the public hostnames in the dashboard tunnel **Public Hostnames** tab:

   | Subdomain | Domain | Service |
   | --- | --- | --- |
   | `cdn` | `argus.example.com` | `http://127.0.0.1:8080` |
   | `app` | `argus.example.com` | `http://127.0.0.1:3000` |

The token is read from `EnvironmentFile` and passed as an argument through a
shell variable. It is never written to the repo, the unit file or logs.

### Alternative: locally-managed tunnel

Use `deploy/cloudflared/config.yml` when ingress lives in a file instead of the
dashboard:

```bash
cloudflared tunnel login
cloudflared tunnel create argus
sudo install -d -m 700 /etc/argus/cloudflared
sudo install -m 600 ~/.cloudflared/<TUNNEL_ID>.json \
  /etc/argus/cloudflared/credentials.json
sudo install -m 600 deploy/cloudflared/config.yml \
  /etc/argus/cloudflared/config.yml
sudo cloudflared tunnel --config /etc/argus/cloudflared/config.yml run argus
```

The credentials JSON is a secret and stays outside the repository. Rotate it by
creating a new tunnel and replacing the file, then restarting the unit.

## 4. Origin firewall

Run one of:

```bash
# nftables
sudo nft -f deploy/firewall/argus-origin.nft

# or UFW
sudo ARGUS_OPERATOR_CIDR=203.0.113.0/24 deploy/firewall/apply-ufw.sh
```

Both policies deny inbound traffic by default. Ports `8080` and `3000` are not
opened. Keep `HOST=127.0.0.1` in `apps/cdn/.env` and bind Next.js with
`next start -H 127.0.0.1`.

## 5. Cache behaviour

The CDN sets origin headers for every stored asset:

| Path | Origin header | Cloudflare cache rule |
| --- | --- | --- |
| `/raw/*` | `public, max-age=31536000, immutable` | Cache eligible, Edge TTL 1 year, Browser TTL respect origin |
| `/annotated/*` | `public, max-age=31536000, immutable` | Cache eligible, Edge TTL 1 year |
| `/audio/*` | `public, max-age=31536000, immutable` | Cache eligible, Edge TTL 1 year |
| `/reconsider/*` | `public, max-age=31536000, immutable` | Cache eligible, Edge TTL 1 year |
| `/api/upload` | `no-store`, `Pragma: no-cache` | Bypass cache |
| `/healthz` | no explicit cache header | Bypass cache |

Why immutable is safe: stored filenames contain a UUID and are never rewritten.
A new upload always creates a new key. The `reconsider` category is included
because attachments are also content-addressed by UUID; the required
`raw`/`annotated`/`audio` categories are covered explicitly.

Cloudflare dashboard → Caching → Cache Rules:

1. **Bypass API** — `http.request.uri.path matches "^/api/"` → Bypass cache.
2. **Immutable assets** — `http.request.uri.path matches "^/(raw|annotated|audio|reconsider)/"` → Eligible for cache, Edge TTL 1 year, Cache Key includes host + path.
3. **Health** — `http.request.uri.path eq "/healthz"` → Bypass cache.

Do not enable "Cache Everything" on `/api/*` or on HTML responses.

## 6. Verification checklist

Run these from a host **outside** the Mini PC's LAN.

- [ ] DNS resolves to Cloudflare, not the origin IP:
      `dig +short cdn.argus.example.com` returns Cloudflare addresses.
- [ ] HTTPS works and the certificate is issued by Cloudflare:
      `curl -vI https://cdn.argus.example.com/healthz` shows the Cloudflare
      certificate chain and `server: cloudflare`.
- [ ] The origin port is unreachable directly:
      `curl --connect-timeout 5 http://<origin-public-ip>:8080/healthz` fails
      with connection refused/timeout, and the same for `:3000`.
- [ ] Asset caching:
      `curl -I https://cdn.argus.example.com/raw/2026/11/<file>.png` contains
      `cache-control: public, max-age=31536000, immutable` and a
      `cf-cache-status` of `MISS` then `HIT` on the second request.
- [ ] Upload caching is disabled:
      `curl -i -X OPTIONS https://cdn.argus.example.com/api/upload` and an
      authenticated upload both show `cache-control: no-store`.
- [ ] Tunnel token is only on disk at `/etc/argus/cloudflared.env` with mode
      600, and `git grep TUNNEL_TOKEN` finds only the example placeholder.
- [ ] `ss -ltnp | grep -E ':8080|:3000'` shows `127.0.0.1` only.

Local pre-flight (Windows development host):

```powershell
# With the CDN running locally:
powershell -ExecutionPolicy Bypass -File deploy/verify-origin.ps1 -Port 8080
```

The script fails if the listener is not loopback-only or if the host LAN
address accepts a connection on the CDN port.

## 7. Local verification evidence

On the development host the CDN is started with `HOST=127.0.0.1` from
`apps/cdn/.env`. The verification script reports:

- listener `127.0.0.1:8080` only;
- the host LAN address refuses the connection on `8080`;
- `/healthz` returns 200 over loopback;
- stored assets return `cache-control: public, max-age=31536000, immutable`;
- `/api/upload` returns `cache-control: no-store`.

The public-internet probe is performed from an external network after the
tunnel is installed on the Mini PC; record the command output in the rollout
ticket.
