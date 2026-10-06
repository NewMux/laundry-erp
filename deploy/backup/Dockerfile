# Nightly backups: pg_dump + uploaded files → encrypted restic repository
# on a Hetzner Storage Box (SFTP, port 23).
FROM postgres:16-alpine
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
