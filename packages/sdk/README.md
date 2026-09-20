# @socialrobot-io/reflow-sdk

Browser-compatible TypeScript client for triggering published Reflow workflows.

```sh
pnpm add @socialrobot-io/reflow-sdk
```

Create a user-bound API key with the `send` scope, then keep it in your UI server/action environment (never in browser JavaScript):

```sh
reflow call credential.create --input '{"userId":"USER_ID","name":"product-ui","scopes":["send"]}'
```

```ts
import { ReflowSdk } from '@socialrobot-io/reflow-sdk';

const reflow = new ReflowSdk({
  url: process.env.REFLOW_URL!,
  apiKey: process.env.REFLOW_API_KEY!,
  workspaceId: process.env.REFLOW_WORKSPACE_ID!,
});

const result = await reflow.trigger({
  workflowVersionId: 'PUBLISHED_WORKFLOW_VERSION_ID',
  contact: { email: user.email, externalId: user.id, fields: { firstName: user.name } },
  variables: { plan: user.plan },
  idempotencyKey: `welcome:${user.id}`,
});
```

`trigger()` upserts the contact and creates a durable enrollment. Reusing the same idempotency key makes retries safe. The API key must be scoped to `send`; workspace roles and workflow policy are still enforced by Reflow.

For a browser-only UI, call your own server endpoint or server action that uses this SDK. Do not expose a Reflow API key in a public bundle.
