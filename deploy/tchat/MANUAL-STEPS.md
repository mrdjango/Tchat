# Manual steps before Tchat can go live

Everything here needs credentials or console access that the code cannot reach.
Ordered so each step's prerequisites are already done.

## Done already

Verified or completed while setting this up — recorded here so nobody redoes them.

| Step | State |
| --- | --- |
| DNS | `chat.tensorgrid.space` A → `65.109.217.42`, proxied. Already present. |
| TLS | The origin cert's SAN is `*.tensorgrid.space, tensorgrid.space`, valid to 2041. **No reissue needed.** |
| Docker networks | No longer a manual step. `tchat_edge` and `tensorgrid_edge` are declared with explicit `name:` in the TensorGrid stack, which creates them on deploy. |
| Doppler `tchat-be-fe/prd` | Fully populated, including `TENSORGRID_INTEGRATION_SECRET` copied from the Komodo stack (digest-verified identical) and `TCHAT_INTEGRATION_SECRET` mirrored into `tensorgrid-be-fe/prd_backend`. |
| Doppler service token | `tchat-prd-komodo`, read-only, already set as `DOPPLER_TOKEN` in the Komodo stack. |
| Komodo stack | `tchat-production` created: server `65.109.217.42:8120`, run dir `/opt/tchat`, project `tchat`, GHCR account `mrdjango` attached, `--remove-orphans`. **Not deployed.** |
| Stack files on host | `/opt/tchat` populated. `docker compose config` and `nginx -t` both pass there. |

## 1. Release, in this order

Everything below is gated on the incident in the next section. Do not start
until `IMAGE_TAG` is a real SHA again.

1. **Merge and build.** Merge mrdjango/TensorGrid#143, then mrdjango/Tchat#1.
   Merging the Tchat PR triggers `.github/workflows/tchat-images.yml`, which
   publishes `tchat-api` and `tchat-broker` at the merged commit SHA.
2. **Set the tag.** Put that SHA in `TCHAT_IMAGE_TAG` in the `tchat-production`
   stack environment, replacing the branch SHA that is there now.
3. **Deploy TensorGrid first.** Its release carries the `chat.tensorgrid.space`
   server block and creates both shared networks. Afterwards confirm the main
   site, `api.`, `admin.`, `gateway.` and `djadmin.` still answer — the shared
   `proxy` container restarts as part of it.
4. **Deploy Tchat second.** Wait for every service to report healthy.
5. **Verify.** The checks in `README.md` under "Verifying a deploy".

Deploying Tchat first is harmless but pointless: nothing routes to it yet.

## 2. GHCR package visibility

Komodo holds a `ghcr.io` registry account (`mrdjango`) and the stack is
configured to use it, so the two new packages can stay **private** — that
credential is what pulls them.

They do not exist until CI first publishes them, and GitHub creates new
packages private by default, so there is most likely nothing to do. Confirm
after the first build that both are private and that the Komodo registry
account can read them. This could not be checked in advance: the `gh` token on
this machine has no `read:packages` scope.

## 3. Sign-in

Every TensorGrid user can sign in with their existing account, and the Tchat
user is created automatically on first sign-in. That needs OIDC switched on —
three short steps in `OIDC.md` (generate a signing key, register the client,
set the `OPENID_*` values).

Until then Tchat has no way for anyone to log in, since registration is closed
and no local accounts exist. To create a break-glass admin in the meantime:

```bash
docker compose -p tchat exec tchat-api npm run create-user
```

Use the **exact email of that person's TensorGrid account** — it is what the
broker resolves to a gateway subject, and a mismatch means they can sign in but
not send a message.

## 4. Brand assets

`branding/` currently holds the TensorGrid mark as a stand-in. Drop the real
Tchat artwork in under the same filenames:

```
logo.svg                        login page
tchat-mark.svg                  endpoint icon in the model menu
favicon-16x16.png               16x16
favicon-32x32.png               32x32
apple-touch-icon-180x180.png    180x180
icon-192x192.png                192x192
maskable-icon.png               512x512, safe area inset ~10%
```

`branding/` is bind-mounted from `/opt/tchat/branding`, so replacing a file and
redeploying is enough - no image rebuild. Browsers and the service worker cache
these aggressively; expect a hard refresh to be needed.

## Still open

- **RAG / file search.** `tchat-vectordb` and `tchat-rag` are defined behind
  the `rag` Compose profile and are not started. They need an embeddings
  credential, and Tchat's premise is that inference only leaves through the
  broker, so enable them once the Gateway catalog exposes an embeddings model.
- **Sidebar link.** Nothing in the TensorGrid frontend links to Tchat yet, and
  you mentioned `chat.tensorgrid.ai` while this deploys `chat.tensorgrid.space`.
  Worth settling before the link is added.

## Backup incident: resolved

`tensorgrid-production` ran with `IMAGE_TAG=main` instead of a 40-character
SHA, which crash-looped `postgres-backup` and `pre-migration-backup` and would
have stalled the next deploy at `migration`.

Both parts are fixed:

- Your own CI redeploy restored the acute failure — backups completed again
  from 2026-08-30 09:16 UTC.
- mrdjango/TensorGrid#145 removed the cause structurally: `postgres-backup`
  now bakes its release identity into the image at build time (a CI build-arg
  with no default, so the image refuses to build without it) rather than
  reading `IMAGE_TAG`. That variable's format can no longer break backups.
- mrdjango/TensorGrid#147 fixed the smoke build in `tests.yml`, which #145
  had missed.
