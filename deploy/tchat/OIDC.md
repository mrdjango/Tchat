# Signing in to Tchat through TensorGrid

Every TensorGrid user can sign in to Tchat with their existing account. There
is no separate Tchat password, and no account to create by hand: the first
successful sign-in provisions the Tchat user automatically, linked by email.

## How it works

TensorGrid is the OpenID Connect provider (mrdjango/TensorGrid#149). Tchat is
a confidential authorization-code client.

```
Tchat "Continue with TensorGrid"
  └─> https://tensorgrid.space/oauth/authorize?client_id=…&redirect_uri=…&state=…&nonce=…
        │  Angular route. Already signed in? straight through.
        │  Not signed in? normal TensorGrid login, then returns here.
        ▼
      POST /sso/authorize/   (the SPA's own access token, in the body)
        │  verifies the JWT, opens a Django session, forwards the OIDC params
        ▼
      GET /o/authorize/      django-oauth-toolkit issues the code
        ▼
  redirect to https://chat.tensorgrid.space/oauth/openid/callback?code=…&state=…
        ▼
      POST /o/token/         code -> id_token (RS256) + access_token
        ▼
      Tchat validates the ID token against /o/.well-known/jwks.json
```

The bridge exists because the TensorGrid frontend is a JWT-based SPA and never
establishes a Django session, while the authorize endpoint needs a
browser-authenticated user. It is the only place the two meet.

### Why the bridge is not CSRF-token protected

It is authenticated by a bearer token in the request body rather than a cookie,
so there is no ambient authority for a CSRF token to protect. The risk that
remains is *login* CSRF — a third-party page posting its own token to sign a
visitor into the attacker's account — so the view validates the initiating
`Origin` (falling back to `Referer`). That is the same check Django's CSRF
middleware performs, and unlike a token it works for a plain form post.

## Endpoints

| Purpose | URL |
| --- | --- |
| Discovery | `https://tensorgrid.space/o/.well-known/openid-configuration` |
| Authorize (entry point Tchat uses) | `https://tensorgrid.space/oauth/authorize` |
| Token | `https://tensorgrid.space/o/token/` |
| Userinfo | `https://tensorgrid.space/o/userinfo/` |
| JWKS | `https://tensorgrid.space/o/.well-known/jwks.json` |

## Claims

| Claim | Use |
| --- | --- |
| `sub` | Stable identifier, stored as the Tchat user's `openidId`. |
| `email` | Account linking and display. |
| `email_verified` | Whether the TensorGrid email is verified. |
| `name`, `preferred_username` | Display name. |
| `gateway_subject_id` | The user's Models Gateway subject. |

`gateway_subject_id` is the one that matters for billing. The broker forwards
`sub` as `X-Tchat-User-Openid`, and `model_hub.tchat._resolve_user` looks a
subject up by that value first — so once tokens carry it, the broker resolves
identity from the token alone and its Django round trip disappears from the
request path. Email lookup remains the fallback.

## Turning it on

**1. Generate a signing key** (2048-bit RSA, never committed):

```bash
openssl genrsa 2048 | doppler secrets set -p tensorgrid-be-fe -c prd_backend OIDC_RSA_PRIVATE_KEY
doppler secrets set -p tensorgrid-be-fe -c prd_backend OIDC_ENABLED=true
doppler secrets set -p tensorgrid-be-fe -c prd_backend OIDC_ISSUER_URL=https://tensorgrid.space/o
```

Until both `OIDC_ENABLED` and a key are set, the provider stays off and the
discovery document is not served — so deploying the code changes nothing.

**2. Register Tchat as a client**, on the production backend:

```bash
docker compose -p tensorgrid exec backend python manage.py register_oidc_client \
  --name Tchat \
  --redirect-uri https://chat.tensorgrid.space/oauth/openid/callback
```

It prints `client_id` and, on first run only, `client_secret`. The command is
idempotent by name: re-running updates redirect URIs in place and leaves the
secret alone unless `--rotate-secret` is passed, so a redirect change never
silently invalidates the deployed client.

**3. Point Tchat at it** (`tchat-be-fe/prd`):

```
OPENID_ISSUER=https://tensorgrid.space/o
OPENID_CLIENT_ID=<from step 2>
OPENID_CLIENT_SECRET=<from step 2>
OPENID_SESSION_SECRET=<openssl rand -hex 32>
OPENID_SCOPE=openid profile email
OPENID_CALLBACK_URL=/oauth/openid/callback
OPENID_BUTTON_LABEL=Continue with TensorGrid
OPENID_EMAIL_CLAIM=email
OPENID_NAME_CLAIM=name
OPENID_USERNAME_CLAIM=email
OPENID_POST_LOGOUT_REDIRECT_URI=https://tensorgrid.space
OPENID_USE_END_SESSION_ENDPOINT=true
ALLOW_SOCIAL_LOGIN=true
ALLOW_SOCIAL_REGISTRATION=true
```

`ALLOW_SOCIAL_REGISTRATION=true` is what auto-provisions the Tchat user on
first sign-in. `librechat.yaml` already carries
`registration.socialLogins: ['openid']`, so nothing changes there.

**4. Cut over in two steps**, so a broken IdP cannot lock everyone out:

1. Deploy with `ALLOW_EMAIL_LOGIN=true` still set and confirm a real user can
   sign in through TensorGrid and send a message.
2. Then set `ALLOW_EMAIL_LOGIN=false` and `OPENID_AUTO_REDIRECT=true`, making
   TensorGrid the only way in — **including from Tchat-Mobile: verify the mobile client signs in
   successfully under `ALLOW_EMAIL_LOGIN=false` before removing the break-glass admin.** A mobile
   OIDC failure is silent from the web side, so step 1 passing there is not evidence step 2 is safe.

Keep one break-glass local admin until step 2 has held.

## Mobile clients

Tchat-Mobile (the native Android/iOS client, `TensorGrid-stacks/Tchat-Mobile`) uses this same
flow — no second OIDC client and no extra redirect URI are needed. Its OAuth launch and the
callback both end at `https://chat.tensorgrid.space`, exactly like the web client, so the single
redirect URI registered in step 2 above covers both. `OPENID_USE_PKCE=false` is fine for it too,
for the same reason it's fine for web: the authorization code never leaves the server:
`oauthHandler` exchanges it for tokens server-side before ever redirecting back to the client.

As of this writing the mobile client's OAuth flow itself is still being hardened — see
`Tchat-Mobile/TCHAT.md`'s "OIDC: known-fragile" section before flipping
`ALLOW_EMAIL_LOGIN=false` in production. `NON_BROWSER_VIOLATION_SCORE=0` (in `env.example`) is a
separate, already-required prerequisite for the mobile client generally, not specific to OIDC.

## Notes

- **Existing accounts.** LibreChat links an OIDC identity to an existing local
  user by email, so anyone who already has a Tchat account keeps their history
  provided the emails match exactly.
- **No credit, no messages.** Auto-provisioning grants a chat account, not
  spend. Billing still flows through the broker and the reserved `TCHAT`
  gateway token, so a user with no TensorGrid credit signs in fine and gets a
  clear error on send. SSO decides *who* the user is; the broker still decides
  *whose credit* pays.
- **Roles.** `OPENID_ADMIN_ROLE` with `OPENID_ADMIN_ROLE_PARAMETER_PATH` can
  promote TensorGrid staff to Tchat admins from a token claim. Generic role
  sync deliberately cannot grant ADMIN.
- **Key rotation.** Replacing `OIDC_RSA_PRIVATE_KEY` invalidates outstanding ID
  tokens; users re-authenticate silently if their TensorGrid session is live.
