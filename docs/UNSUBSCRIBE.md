# Unsubscribe and consent

Rachet adds an unsubscribe link and mailbox one-click headers to each marketing email. An opt-out blocks all later marketing from the same workspace. Necessary account and service mail can still send unless a delivery block applies.

## Set up marketing mail

1. Set `UNSUBSCRIBE_SIGNING_KEYS` to a base64-encoded 32-byte key on the server and worker. `pnpm dev` creates one in `.env.local`. Back it up. During rotation, put the new key first and keep prior keys after commas while old links must work.
2. Set `UNSUBSCRIBE_SUPPORT_EMAIL` on the server. Recipients see this address when a link is invalid or revoked.
3. As an organization owner or admin, open **Integrations → Email → Resend** and select **Set up marketing email**. Enter the sender name, support email, and a verified marketing From address that differs from the transactional sender. Save these with the connection settings. The page shows the plain-text footer in an example email. You can also use `email_policy.update` through CLI or MCP:

   ```sh
   rachet call email_policy.update --input '{"workspaceId":"WORKSPACE_ID","senderName":"Acme","supportEmail":"support@acme.example","marketingFromAddress":"news@acme.example"}'
   ```

4. Set `purpose` to `marketing` for promotions, newsletters, and other optional mail. Set it to `transactional` for mail needed to complete a requested account or service action. Purpose belongs to the workflow, not the template. Publish the workflow before enrollment.
5. Ask the person to opt in, confirm control of their email address, and record that confirmation before marketing enrollment. Store a reference to the confirmed request in `consentReference`:

   ```sh
   rachet call contact.resubscribe --input '{"workspaceId":"WORKSPACE_ID","email":"person@example.com","eventId":"consent:REQUEST_ID","source":"product","consentReference":"confirmed-signup:REQUEST_ID"}'
   ```

6. Before live marketing traffic, complete the [Gmail sender checks](RESEND.md#gmail-sender-checks). Send to an allowed staging inbox. Confirm that the delivered HTML and plain-text parts have the link, both `List-Unsubscribe` headers are present, and a passing DKIM signature covers both headers. Test the body form and one-click POST. A POST must opt the address out without a login or confirmation step.

Use the same `eventId` on retries. `consentReference` must identify the new confirmed request. Rachet stores that reference but cannot check the external confirmation flow. Contact import and upsert do not create consent. Resubscription does not clear a hard bounce, complaint, or other delivery block. It does not restart old enrollments.

The dashboard's template preview includes the marketing footer when the workflow is marketing and the workspace email policy is set. If the footer is absent, complete step 3 from the preview's **Manage marketing email settings** link. The preview link is an example and cannot change a preference. Use **Enrollments** to see each run and its exit state. A contact can appear more than once because each enrollment is a separate run.

## Handle a support request

Record an opt-out with `contact.unsubscribe`:

```sh
rachet call contact.unsubscribe --input '{"workspaceId":"WORKSPACE_ID","email":"person@example.com","eventId":"support:REQUEST_ID","source":"support"}'
```

Use `contact.preferences.get` to inspect marketing and delivery eligibility. Use `subscription_event.list` to synchronize preference changes with a product system.

For a link or mailbox unsubscribe, each event includes `origin` with the exact send ID, enrollment ID, workflow ID and version, workflow name, email step, template version, and subject. Rachet saves these details when it prepares the email, so the event keeps them if the enrollment or workflow is later deleted. Support and product changes have `origin: null`. Open an enrollment to see marketing preference history for that address. The opt-out still applies to all marketing in the workspace.

Each new support or product request needs a new `eventId`. A repeated request while the address is already opted out records the request but leaves the opt-out in place. Retry the same request with its original `eventId`; it cannot reverse a later resubscription.

Opening a recipient link with GET does not change a preference. The browser form and mailbox one-click POST do. The link applies to the address used for that message. A marketing opt-out also stops affected active marketing enrollments. An email admitted to the provider before the opt-out commits cannot be recalled.

Use `template.render` with `marketingPreview: true` to inspect the managed footer in HTML and plain text after configuring the email policy.

The first release uses workspace-wide marketing scope. Named topics, custom footers, and signed change webhooks are planned in [the delivery plan](UNSUBSCRIBE_PLAN.md).
