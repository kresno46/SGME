#!/usr/bin/env bash
# =====================================================================
# Solid Mini Growth Engine — perintah operasional produksi
# Pemakaian: ./infrastructure/scripts/smge.sh <perintah>
#   init-ssl   Ambil sertifikat Let's Encrypt pertama kali (sebelum "up")
#   up         Build image & jalankan semua layanan
#   down       Hentikan semua layanan (data tetap tersimpan)
#   update     git pull → build → jalankan ulang (migrasi otomatis)
#   status     Status layanan & health check
#   logs [svc] Ikuti log (mis. logs api)
#   backup     Backup database ke ./backups
#   restore F  Pulihkan database dari file backup F (HATI-HATI)
#   reload-nginx  Muat ulang konfigurasi/sertifikat Nginx
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
ENV_FILE=".env.production"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml)

die() { echo "✖ $*" >&2; exit 1; }
[ -f "$ENV_FILE" ] || die "$ENV_FILE tidak ditemukan. Salin dari .env.production.example lalu isi nilainya."

# Ambil satu nilai dari .env.production tanpa mengeksekusi file
envval() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }

# WhatsApp (WAHA) opsional: ikut dipasang hanya bila diaktifkan di .env.production
if [ "$(envval WAHA_ENABLED)" = "true" ]; then COMPOSE+=(-f docker-compose.waha.yml); fi

if grep -q "GANTI_" "$ENV_FILE"; then
  die "Masih ada nilai GANTI_… di $ENV_FILE. Isi semua secret terlebih dahulu."
fi

cmd="${1:-}"
shift || true

case "$cmd" in
  init-ssl)
    DOMAIN="$(envval DOMAIN)"; EMAIL="$(envval LETSENCRYPT_EMAIL)"
    [ -n "$DOMAIN" ] && [ -n "$EMAIL" ] || die "DOMAIN dan LETSENCRYPT_EMAIL wajib diisi"
    echo "→ Meminta sertifikat untuk $DOMAIN (port 80 harus bebas & DNS sudah mengarah ke server ini)"
    "${COMPOSE[@]}" stop nginx 2>/dev/null || true
    "${COMPOSE[@]}" run --rm -p 80:80 --entrypoint certbot certbot \
      certonly --standalone --non-interactive --agree-tos --no-eff-email \
      -m "$EMAIL" -d "$DOMAIN"
    echo "✔ Sertifikat siap. Lanjutkan: $0 up"
    ;;

  up)
    "${COMPOSE[@]}" up -d --build --remove-orphans
    "${COMPOSE[@]}" ps
    ;;

  down)
    "${COMPOSE[@]}" down
    ;;

  update)
    git pull --ff-only
    "$0" backup
    "${COMPOSE[@]}" up -d --build --remove-orphans
    docker image prune -f >/dev/null
    "${COMPOSE[@]}" ps
    ;;

  status)
    "${COMPOSE[@]}" ps
    DOMAIN="$(envval DOMAIN)"
    echo "→ Health: https://$DOMAIN/api/health"
    curl -fsS "https://$DOMAIN/api/health" && echo || echo "✖ health check gagal"
    ;;

  logs)
    "${COMPOSE[@]}" logs -f --tail=200 "$@"
    ;;

  backup)
    mkdir -p backups
    USER_DB="$(envval POSTGRES_USER)"; NAME_DB="$(envval POSTGRES_DB)"
    KEEP="$(envval BACKUP_RETENTION_DAYS)"; KEEP="${KEEP:-14}"
    FILE="backups/smge-$(date +%Y%m%d-%H%M%S).dump"
    "${COMPOSE[@]}" exec -T postgres pg_dump -U "$USER_DB" -d "$NAME_DB" --format=custom --no-owner > "$FILE"
    [ -s "$FILE" ] || die "Backup kosong — periksa layanan postgres"
    chmod 600 "$FILE"
    find backups -name 'smge-*.dump' -type f -mtime +"$KEEP" -delete
    echo "✔ Backup: $FILE ($(du -h "$FILE" | cut -f1)). Simpan salinan di luar server (offsite)."
    ;;

  restore)
    FILE="${1:-}"; [ -f "$FILE" ] || die "Pemakaian: $0 restore backups/smge-YYYYMMDD-HHMMSS.dump"
    USER_DB="$(envval POSTGRES_USER)"; NAME_DB="$(envval POSTGRES_DB)"
    read -r -p "Ini akan MENIMPA database $NAME_DB dengan $FILE. Ketik 'pulihkan' untuk lanjut: " ok
    [ "$ok" = "pulihkan" ] || die "Dibatalkan"
    "$0" backup
    "${COMPOSE[@]}" stop api worker dashboard
    "${COMPOSE[@]}" exec -T postgres pg_restore -U "$USER_DB" -d "$NAME_DB" --clean --if-exists --no-owner < "$FILE"
    "${COMPOSE[@]}" up -d api worker dashboard
    echo "✔ Database dipulihkan dari $FILE"
    ;;

  reload-nginx)
    "${COMPOSE[@]}" exec nginx nginx -s reload
    ;;

  *)
    sed -n '3,15p' "$0"
    exit 1
    ;;
esac
