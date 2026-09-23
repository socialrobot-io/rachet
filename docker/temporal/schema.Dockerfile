FROM temporalio/admin-tools:1.29.1-tctl-1.18.4-cli-1.5.0

COPY docker/temporal/scripts /scripts

ENTRYPOINT ["/bin/sh"]
CMD ["/scripts/setup-postgres.sh"]
