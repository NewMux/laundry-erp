# Nightly backups: pg_dump + uploaded files → encrypted restic repository
# on a Hetzner Storage Box (SFTP, port 23).
# PG_MAJOR must be >= the server's major version (pg_dump refuses newer servers):
# 16 for the compose stack, 17 for current Supabase projects.
ARG PG_MAJOR=16
FROM postgres:${PG_MAJOR}-alpine
RUN apk add --no-cache restic openssh-client tzdata
ENV TZ=Asia/Bahrain \
    BACKUP_SCHEDULE="0 3 * * *" \
    BACKUP_KEEP_DAILY=14 \
    BACKUP_KEEP_WEEKLY=8 \
    BACKUP_KEEP_MONTHLY=12 \
    RESTIC_CACHE_DIR=/cache
COPY backup.sh restore.sh entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/entrypoint.sh
VOLUME ["/cache"]
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
