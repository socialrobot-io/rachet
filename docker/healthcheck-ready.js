const url = process.env.HEALTHCHECK_URL ?? 'http://127.0.0.1:3000/health/ready';

fetch(url)
  .then((response) => process.exit(response.ok ? 0 : 1))
  .catch(() => process.exit(1));
