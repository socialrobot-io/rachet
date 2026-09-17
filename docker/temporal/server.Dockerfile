FROM temporalio/server:1.29.1

# The server also needs this file after the deployment checkout is cleaned up.
COPY docker/temporal/dynamicconfig /etc/temporal/config/dynamicconfig
