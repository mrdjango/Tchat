#!/bin/sh
# Fetch this service's configuration from Doppler and exec the real process.
#
# DOPPLER_PRESERVE_ENV mirrors the DOPPLER_PRESERVE_EXISTING convention the
# TensorGrid backend uses: values that describe stack topology (service DNS
# names, ports) are declared in Compose next to the services they point at,
# and Doppler owns everything else.
set -eu

if [ -z "${DOPPLER_TOKEN:-}" ]; then
  echo "DOPPLER_TOKEN is required; set it in the Komodo stack environment" >&2
  exit 1
fi

if [ -n "${DOPPLER_PRESERVE_ENV:-}" ]; then
  exec doppler run --preserve-env="${DOPPLER_PRESERVE_ENV}" -- "$@"
fi

exec doppler run -- "$@"
