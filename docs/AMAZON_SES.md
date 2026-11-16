# Amazon SES setup

An organization owner or admin can connect Amazon Simple Email Service (SES) for workflow and one-off email. Choose **Integrations → Email → Amazon SES**. The CLI and MCP use the same active provider for the organization. Sign-in email uses the deployment's authentication settings.

## Set up AWS

1. In a commercial AWS Region, verify your sender domain or email address in SES. Set up DKIM for a domain. If the account is in the SES sandbox, use the mailbox simulator or a verified recipient. Request production access in that Region before sending to other recipients. [AWS identity setup](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html) · [AWS production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)
2. Create a dedicated IAM user for this organization. Grant it `ses:SendEmail` for the verified identity. Limit the allowed From addresses to the addresses this organization uses. Create an access key for this user. Keep both key fields private. [SES actions and resources](https://docs.aws.amazon.com/service-authorization/latest/reference/list_sesv2.html)
3. Create an SES configuration set and a **Standard** Amazon Simple Notification Service (SNS) topic in the same AWS account and Region. Set the topic's signature version to **2**. Limit publishing on this topic to your SES configuration set. In the topic policy, grant `sns:Publish` to `ses.amazonaws.com` and restrict it with both `AWS:SourceAccount` and the configuration set's exact `AWS:SourceArn`. [SES event destination and topic policy](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-add-event-destination-sns.html) · [SNS signature versions](https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html)
4. Add and enable an SNS event destination on the configuration set. Select **Sends**, **Deliveries**, **Bounces**, and **Complaints**. You can also record rejects, delivery delays, opens, and clicks. Opens and clicks depend on the tracking settings in SES. [SES event types](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_EventDestination.html)

To set the signature version with the AWS CLI, set `SES_REGION` and `SES_TOPIC_ARN` to the Region and topic ARN from step 3. [AWS CLI reference](https://docs.aws.amazon.com/cli/latest/reference/sns/set-topic-attributes.html)

```sh
aws sns set-topic-attributes \
  --region "$SES_REGION" \
  --topic-arn "$SES_TOPIC_ARN" \
  --attribute-name SignatureVersion \
  --attribute-value 2
```

## Connect Rachet

1. Set `INTEGRATION_ENCRYPTION_KEY` on the app, worker, and dispatcher as described in [Deployment](DEPLOYMENT.md). Apply the database migrations before starting the new app and worker.
2. In the Amazon SES settings page, enter the verified transactional From address, AWS Region, configuration set name, SNS topic ARN, and both IAM key fields. Save the connection. Rachet encrypts the key and does not return it in API responses. Enter these credentials only in the connection form.
3. In SNS, create an HTTPS subscription to the exact endpoint shown on the settings page. Leave **raw message delivery** off. SNS must reach this endpoint from AWS. Rachet checks the topic and signature before it confirms the subscription. Click **Refresh status** to check confirmation. [AWS HTTPS subscription setup](https://docs.aws.amazon.com/sns/latest/dg/sns-http-https-endpoint-as-subscriber.html)
4. Send a test email. Select **Use the SES mailbox simulator** if you cannot send to your sign-in address in the sandbox. When SES accepts the test, Rachet activates the provider. The test checks submission. Check the inbox or SES event logs for delivery.
5. For marketing email, set a separate SES-verified From address in **Marketing email** and save the sender name and support email. This uses the same organization policy as `email_policy.update`. Rachet includes its unsubscribe footer and one-click headers. Check the headers and DKIM coverage in a delivered test message before a marketing rollout. [AWS custom headers example](https://docs.aws.amazon.com/ses/latest/dg/sesv2_example_sesv2_SendEmail_section.html)

## Verify events before sending to customers

1. Send a one-off transactional message or run a test workflow for `success@simulator.amazonses.com`. Check that `message.list` shows `accepted`. Ask a deployment administrator to check that `webhook_event.list` shows `email.delivered` for the same provider message ID.
2. Repeat with `bounce@simulator.amazonses.com` and `complaint@simulator.amazonses.com` in a test organization. Check that `contact.preferences.get` reports a delivery block for each address. Permanent bounces and complaints block later mail to the address in that organization. Rachet records temporary bounces without adding a permanent block. [AWS mailbox simulator](https://docs.aws.amazon.com/ses/latest/dg/send-an-email-from-console.html) · [SES event fields](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html)
3. If the event is missing, check the configuration set, SNS subscription status, topic policy, and SNS delivery logs. Configure an SNS dead-letter queue if you need to recover notifications after SNS stops retrying. [SNS delivery retries](https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html)

## Change or recover the connection

- To rotate the IAM key, save the replacement key, test the connection again, then revoke the old key in AWS. A change to the active connection pauses new sends until an accepted test. Review queued and in-flight sends before you change settings.
- To switch providers, test the other provider from its integration page. Prepared sends keep their original provider and connection version. Keep the old event subscription while deliveries from the old provider can still report events.
- If SES times out or returns a server error, it might already have accepted the email. Rachet holds the send for review. A matching signed SES event can resolve the ledger entry to `accepted`. Check `message.list` and AWS before creating a replacement send. A workflow held for review stays there until an operator acts. [AWS ambiguous send guidance](https://docs.aws.amazon.com/ses/latest/dg/troubleshoot-error-messages.html)
