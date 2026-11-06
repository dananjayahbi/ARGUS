#!/usr/bin/env bash
# UFW equivalent of argus-origin.nft.
# Run as root on the Mini PC. Set ARGUS_OPERATOR_CIDR to your admin network.
#
#   sudo ARGUS_OPERATOR_CIDR=203.0.113.0/24 ./apply-ufw.sh
#
# Do NOT run `ufw allow 8080` or `ufw allow 3000`. Those ports stay on
# loopback and are reached only by cloudflared on the same host.

set -euo pipefail

ufw default deny incoming
ufw default allow outgoing
ufw allow from "${ARGUS_OPERATOR_CIDR:-192.168.0.0/16}" to any port 22 proto tcp
ufw --force enable
ufw status verbose
