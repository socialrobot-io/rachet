FROM temporalio/admin-tools:1.29.1-tctl-1.18.4-cli-1.5.0

# Keep bootstrap scripts inside the image. Coolify can remove the checkout
# directory after Compose creates containers, which makes relative bind mounts
# disappear during restart/retry.
COPY docker/temporal/scripts /scripts
