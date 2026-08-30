# Manual steps before Tchat can go live

Everything here needs credentials or console access that the code cannot reach.
Ordered so each step's prerequisites are already done.

## 1. DNS

Add `chat.tensorgrid.space` in Cloudflare:

| Type | Name | Value | Proxy |
| --- | --- | --- | --- |
| A | `chat` | `65.109.217.42` | **Proxied** (orange cloud) |

Proxied is required, not cosmetic: the host firewall
(`TensorGrid/deploy/configure-cloudflare-firewall.sh`) only accepts :80/:443
from Cloudflare ranges, so a grey-cloud record is unreachable.

Add `chat-dev.tensorgrid.space` the same way if you want a staging host — the
nginx server block already answers for it.

## 2. TLS

The Tchat server block reuses the existing origin certificate at
`/opt/tensorgrid/tls/origin.pem`. Confirm it actually covers the new name:

```bash
openssl x509 -in /opt/tensorgrid/tls/origin.pem -noout -text \
  | grep -A1 'Subject Alternative Name'
```

If `*.tensorgrid.space` is not in the SAN list, reissue the Cloudflare origin
certificate with it and replace both `origin.pem` and `origin.key` on the host.
Nothing else changes — the block reads the same two files every other host does.

## 3. Docker networks

Both are external and must exist before **either** stack is redeployed. A
missing network fails the TensorGrid `proxy` service, which would take the main
site down, so do this first:

```bash
docker network create tchat_edge
docker network create tensorgrid_edge
```

`tchat_edge` carries edge nginx → `tchat-proxy`. `tensorgrid_edge` carries
`tchat-broker` → `backend` and `models-gateway`.

## 4. Doppler

`tchat-be-fe/prd` is already populated: branding, the public origin, the
provider lockdown (`ENDPOINTS=agents`), the day-one auth posture, the broker
tuning, the inert OIDC scaffolding, and freshly generated `JWT_SECRET`,
`JWT_REFRESH_SECRET`, `CREDS_KEY`, `CREDS_IV`, `MEILI_MASTER_KEY`,
`TCHAT_BROKER_SHARED_KEY` and `TCHAT_INTEGRATION_SECRET`.

```bash
doppler secrets -p tchat-be-fe -c prd --only-names   # review
```

Two things are still on you, because neither can be generated in isolation.

**a. Copy the Gateway secret in.** It must equal the TensorGrid production
stack's value exactly — a mismatch makes every token mint fail with
`tensorgrid_unavailable`. It lives in the Komodo stack environment, not in
Doppler, so read it there:

```bash
doppler secrets set -p tchat-be-fe -c prd TENSORGRID_INTEGRATION_SECRET
# paste the TensorGrid stack's TENSORGRID_INTEGRATION_SECRET
```

**b. Mirror the broker secret out**, so Django accepts the broker's signature:

```bash
doppler secrets set -p tensorgrid-be-fe -c prd_backend \
  "TCHAT_INTEGRATION_SECRET=$(doppler secrets get TCHAT_INTEGRATION_SECRET \
     -p tchat-be-fe -c prd --plain)"
```

This writes to the live TensorGrid backend config. It is additive — Django
defaults the setting to empty and only reads it when the broker calls — but it
does need a backend restart to take effect, so fold it into the TensorGrid
release in step 7 rather than doing it separately.

**c. Create the service token** for the Komodo stack environment:

```bash
doppler configs tokens create tchat-prd --project tchat-be-fe --config prd --plain
```

To seed the `dev` config later, the same values work with
`-c dev` and `DOMAIN_CLIENT`/`DOMAIN_SERVER` pointed at
`https://chat-dev.tensorgrid.space`. Generate *different* crypto material for
it; a shared `CREDS_KEY` would let a staging compromise decrypt production.

## 5. GHCR

Confirm the host's registry credential can pull `ghcr.io/mrdjango/tchat-api`
and `ghcr.io/mrdjango/tchat-broker`. Both are new repositories; if the pull
secret is scoped per-package rather than org-wide, grant it access, and mark
them private.

## 6. Komodo stack

Create stack `tchat-production`:

| Field | Value |
| --- | --- |
| Server | `65.109.217.42:8120` |
| Run directory | `/opt/tchat` |
| Compose project | `tchat` |
| Compose file | `deploy/tchat/compose.production.yml` |
| Tracked config files | `deploy/tchat/nginx.conf`, `deploy/tchat/librechat.yaml` |

Stack environment: `TCHAT_IMAGE_TAG` (full 40-character SHA), `DOPPLER_TOKEN`
from step 4, `MEILI_MASTER_KEY` matching the Doppler value, and
`DOPPLER_PROJECT` / `DOPPLER_CONFIG` if they differ from the defaults.

`MEILI_MASTER_KEY` appears in both places because Meilisearch has no Doppler
client of its own. If the two ever drift, `tchat-api` starts but search stops
indexing.

## 7. Deploy, in this order

1. **TensorGrid first.** Its release carries the new `chat.tensorgrid.space`
   server block and the two network attachments. Confirm the main site,
   `api.`, `admin.` and `gateway.` still answer afterwards — the shared `proxy`
   container restarts as part of it.
2. **Tchat second.** Deploy `tchat-production` and wait for every service to
   report healthy.

Deploying Tchat first is harmless but pointless: nothing routes to it yet.

## 8. First accounts

Registration is closed, so create accounts by hand. **Use the same email as the
user's TensorGrid account** — that is what the broker resolves to a Gateway
subject, and a mismatch means the user can sign in but not send a message.

```bash
docker compose -p tchat exec tchat-api npm run create-user
```

## 9. Brand assets

`branding/` currently holds the TensorGrid mark as a stand-in. Drop the real
Tchat artwork in under the same filenames:

```
logo.svg                        login page
tchat-mark.svg                  endpoint icon in the model menu
favicon-16x16.png               16×16
favicon-32x32.png               32×32
apple-touch-icon-180x180.png    180×180
icon-192x192.png                192×192
maskable-icon.png               512×512, safe area inset ~10%
```

`branding/` is bind-mounted, so replacing a file and redeploying the stack is
enough — no image rebuild. Browsers and the service worker cache these
aggressively; expect a hard refresh to be needed to see the change.

## Still open

- **OIDC.** Tchat cannot yet sign users in through TensorGrid, because Django
  is not an identity provider. `OIDC.md` has the full contract and the cutover.
  Until then, the manual account creation in step 8 is what couples a chat user
  to their TensorGrid credit.
- **RAG / file search.** `tchat-vectordb` and `tchat-rag` are defined behind
  the `rag` Compose profile and are not started. They need an embeddings
  credential, and Tchat's premise is that inference only leaves through the
  broker — so enable them once the Gateway catalog exposes an embeddings model.
- **Sidebar link.** Nothing in the TensorGrid frontend links to Tchat yet, and
  you mentioned `chat.tensorgrid.ai` while this deploys `chat.tensorgrid.space`.
  Worth settling before the link is added.
