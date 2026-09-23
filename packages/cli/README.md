# @socialrobot-io/rachet

The CLI for **Rachet, the open-source journey engine for agents**.

Connect to a Rachet deployment, authorize through its dashboard with OAuth + PKCE, and author or operate durable customer journeys from your terminal.

```sh
npm install --global @socialrobot-io/rachet
rachet auth login
```

Login defaults to `https://rachet.dev`. For a self-hosted server, use `rachet auth login --url https://your-rachet.example` or set `REFLOW_URL`. Other commands use your saved server.

Then discover the server’s capabilities or start authoring:

```sh
rachet call system.capabilities
rachet workspace list
rachet template init
rachet template preview
rachet workflow show --name Onboarding
```

Signal a live enrollment with a stable event ID:

```sh
rachet call event.emit --input '{
  "enrollmentId": "ENROLLMENT_ID",
  "eventId": "product-activation:ACTIVITY_ID",
  "eventType": "product.activated",
  "data": {}
}'
```

The CLI stores short-lived access and rotating refresh credentials in a mode-`0600` config file. It never stores your Rachet password or dashboard cookie.

React Email `.tsx` files are trusted local code. Review them before running:

```sh
rachet template push emails/welcome.tsx \
  --name Welcome \
  --subject "Welcome, {{contact.firstName}}" \
  --allow-code-execution
```

Documentation and self-hosting instructions: [github.com/socialrobot-io/rachet](https://github.com/socialrobot-io/rachet)
