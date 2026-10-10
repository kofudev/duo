#!/usr/bin/env bash
# One-time root setup. Public key must already be at /tmp/duo-deploy.pub.
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run as root'; exit 1; }
command -v nginx >/dev/null
command -v python3 >/dev/null
[[ -f /tmp/duo-site-receiver.py && -f /tmp/duo-nginx.conf && -f /tmp/duo-deploy.pub ]]
# Refuse an existing deployment; upgrades must be reviewed and installed explicitly.
[[ ! -e /var/www/duo && ! -L /var/www/duo && ! -e /etc/nginx/sites-available/duo.varelia.fr ]]
! id duo-deploy >/dev/null 2>&1
useradd --system --home-dir /var/lib/duo-deploy --shell /bin/bash duo-deploy
install -d -o root -g root -m 755 /var/lib/duo-deploy /var/lib/duo-deploy/.ssh /usr/local/lib/duo
install -d -o duo-deploy -g duo-deploy -m 755 /var/www/duo /var/www/duo/releases
install -d -o root -g root -m 755 /var/www/duo/acme
install -o root -g root -m 755 /tmp/duo-site-receiver.py /usr/local/lib/duo/site-receiver.py
{
    printf 'restrict,command="/usr/local/lib/duo/site-receiver.py" '
    cat /tmp/duo-deploy.pub
} > /var/lib/duo-deploy/.ssh/authorized_keys
chown root:root /var/lib/duo-deploy/.ssh/authorized_keys
chmod 644 /var/lib/duo-deploy/.ssh/authorized_keys
install -o root -g root -m 644 /tmp/duo-nginx.conf /etc/nginx/sites-available/duo.varelia.fr
ln -s /etc/nginx/sites-available/duo.varelia.fr /etc/nginx/sites-enabled/duo.varelia.fr
if ! nginx -t; then
    unlink /etc/nginx/sites-enabled/duo.varelia.fr
    exit 1
fi
systemctl reload nginx
echo 'Duo host ready. Deploy site, then provision HTTPS with certbot.'
