# Signing in to Tchat through TensorGrid

Tchat ships with OIDC fully scaffolded but switched off, because TensorGrid is
not yet an identity provider. This is what has to exist on the Django side, and
exactly what to flip when it does.

## Where things stand

Django authenticates its own users with `djangorestframework-simplejwt`. That
issues API tokens for TensorGrid's own frontend; it is not an OIDC provider —
there is no authorization endpoint, no discovery document, no JWKS.

So Tchat launches with local email logins and `ALLOW_REGISTRATION=false`:
accounts are created by an operator and must use the same email address as the
user's TensorGrid account, because that email is what the broker resolves to a
Gateway subject. A chat login with no matching TensorGrid account can sign in
but cannot send a message — it gets `tensorgrid_account_required` in the chat.

That email coupling is the reason to finish this work, not just tidiness.

## What Django needs to provide

Add `django-oauth-toolkit` with its OIDC support enabled and an RSA signing
key, then register Tchat as a confidential client.

**Discovery** — Tchat reads `${OPENID_ISSUER}/.well-known/openid-configuration`
at boot and refuses to start if it 404s. The document must advertise:

| Endpoint | Path under DOT's defaults |
| --- | --- |
| `authorization_endpoint` | `/o/authorize/` |
| `token_endpoint` | `/o/token/` |
| `userinfo_endpoint` | `/o/userinfo/` |
| `jwks_uri` | `/o/.well-known/jwks.json` |
| `end_session_endpoint` | `/o/logout/` |

**Client registration**

| Field | Value |
| --- | --- |
| Client type | confidential |
| Grant type | authorization code |
| Redirect URI | `https://chat.tensorgrid.space/oauth/openid/callback` |
| Post-logout redirect URI | `https://tensorgrid.space` |
| Scopes | `openid profile email` |

**Claims.** Tchat maps these onto its user record:

| Claim | Use | Required |
| --- | --- | --- |
| `sub` | Stable identifier, stored as the user's `openidId`. | yes |
| `email` | Displayed, and used for account linking. | yes |
| `email_verified` | Gate unverified sign-ins. | recommended |
| `name` | Display name. | recommended |
| `gateway_subject_id` | The user's `UserProfile.gateway_subject_id`. | see below |

`gateway_subject_id` is the one worth adding deliberately. The broker forwards
`sub` as `X-Tchat-User-Openid`, and `model_hub.tchat._resolve_user` already
looks a subject up by that value first. So **if `sub` is issued as the
`gateway_subject_id` UUID** — or the extra claim is added and Tchat is
configured with it — the broker resolves identity from the token alone and the
Django round trip disappears from the request path entirely. Otherwise it falls
back to the email lookup, which also works, just with one more hop.

## Flipping it on

In Doppler (`tchat-be-fe/prd`):

```
OPENID_ISSUER=https://tensorgrid.space/o
OPENID_CLIENT_ID=<from the Django client registration>
OPENID_CLIENT_SECRET=<from the Django client registration>
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

`librechat.yaml` already carries `registration.socialLogins: ['openid']`, so no
config change is needed there.

Cut over in two steps rather than one, so a broken IdP does not lock everyone
out:

1. Deploy with both paths live (`ALLOW_EMAIL_LOGIN=true`) and confirm a real
   user can sign in through TensorGrid and send a message.
2. Then set `ALLOW_EMAIL_LOGIN=false` and `OPENID_AUTO_REDIRECT=true`, which
   sends visitors straight to TensorGrid and makes it the only way in.

Keep one break-glass local admin account until step 2 has held for a while.

## Notes

- **Existing accounts.** LibreChat links an OIDC identity to an existing local
  user by email. Because chat accounts were created with the TensorGrid email
  in the first place, users keep their history across the cutover — provided
  the two emails match exactly.
- **Roles.** `OPENID_ADMIN_ROLE` plus `OPENID_ADMIN_ROLE_PARAMETER_PATH` can
  promote TensorGrid staff to Tchat admins from a token claim. Generic role
  sync (`OPENID_ROLE_SYNC_*`) deliberately cannot grant ADMIN.
- **What SSO does not change.** Billing still flows through the broker and the
  reserved `TCHAT` Gateway token. SSO decides *who* the user is; the broker
  still decides *whose credit* pays.
