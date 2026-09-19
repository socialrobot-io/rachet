# @socialrobot-io/reflow

The CLI for **Reflow—the open-source journey engine for agents**.

Connect to a Reflow deployment, authorize through its dashboard with OAuth + PKCE, and author or operate durable customer journeys from your terminal.

```sh
npm install --global @socialrobot-io/reflow
reflow auth login --url https://your-reflow.example
```

Then discover the server’s capabilities or start authoring:

```sh
reflow call system.capabilities
reflow workspace list
reflow template init
reflow template preview
reflow workflow show --name Onboarding
```

Signal a live enrollment with a stable event ID:

```sh
reflow call event.emit --input '{
  "enrollmentId": "ENROLLMENT_ID",
  "eventId": "product-activation:ACTIVITY_ID",
  "eventType": "product.activated",
  "data": {}
}'
```

The CLI stores short-lived access and rotating refresh credentials in a mode-`0600` config file. It never stores your Reflow password or dashboard cookie.

React Email `.tsx` files are trusted local code. Review them before running:

```sh
reflow template push emails/welcome.tsx \
  --name Welcome \
  --subject "Welcome, {{contact.firstName}}" \
  --allow-code-execution
```

Documentation and self-hosting instructions: [github.com/socialrobot-io/reflow](https://github.com/socialrobot-io/reflow)
