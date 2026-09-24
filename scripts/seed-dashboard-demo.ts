#!/usr/bin/env node
/** Local-only, idempotent visual fixtures. Does not enqueue or execute workflows. */
import { createHash, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { workflowDefinitionSchema } from '../packages/contracts/src/index.js';
import { validateActionNodes } from '../apps/server/src/domain/action-catalog.js';
import { simulateWorkflow } from '../apps/server/src/domain/simulate.js';
import { collectEmailSendTemplateRefs } from '../apps/server/src/domain/template-refs.js';
import {
  demoJourneys,
  demoPeople,
  demoTemplates,
  demoWorkflowId,
  type DemoTemplateKey,
  type DemoTemplateVersions,
} from './demo-journeys.js';

const slugs = process.argv.slice(2);
const listing = slugs.length === 1 && slugs[0] === '--list';
if (!listing && (slugs.length === 0 || slugs.some((slug) => !/^[a-z0-9][a-z0-9-]*$/.test(slug)))) {
  throw new Error('Usage: pnpm demo:seed --list | <local-workspace-slug> [local-workspace-slug...]');
}

const legacyNames = ['Demo · First hello', 'Demo · A little nudge', 'Demo · Milestone moment'];
const demoExternalIds = demoPeople.map((person) => person.externalId);
const pool = new Pool({
  connectionString: 'postgresql://reflow:reflow@127.0.0.1:5433/reflow',
  max: 1,
  connectionTimeoutMillis: 3000,
});

type JourneyPin = { sequenceId: string; versionId: string };

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function htmlFor(body: string): string {
  const paragraphs = body.split('\n\n').map((paragraph) => `<p style="margin:0 0 18px;line-height:1.6">${paragraph.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br>')}</p>`).join('');
  return `<html><body style="background:#f7f5ef;padding:32px 12px;font-family:Arial,sans-serif;color:#302321"><div style="max-width:560px;margin:auto;background:white;border-radius:20px;padding:32px"><p style="font-size:22px;font-weight:bold;margin:0 0 28px">reflow.</p>${paragraphs}</div></body></html>`;
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

async function removeLegacyFixtures(client: PoolClient, workspaceId: string): Promise<number> {
  const legacy = await client.query<{ id: string; name: string; demo: boolean }>(
    "select id, name, (definition->>'demo')::boolean as demo from sequences where workspace_id = $1 and name = any($2::text[])",
    [workspaceId, legacyNames],
  );
  for (const row of legacy.rows) {
    if (!row.demo) throw new Error(`Refusing to replace a non-demo workflow: ${row.name}`);
    const [realRuns, sends, queued] = await Promise.all([
      client.query<{ count: number }>(
        "select count(*)::int as count from enrollments e join sequence_versions v on v.id=e.sequence_version_id where v.sequence_id=$1 and e.input->>'demo' is distinct from 'true'",
        [row.id],
      ),
      client.query<{ count: number }>(
        'select count(*)::int as count from send_intents s join enrollments e on e.id=s.enrollment_id join sequence_versions v on v.id=e.sequence_version_id where v.sequence_id=$1',
        [row.id],
      ),
      client.query<{ count: number }>(
        'select count(*)::int as count from outbox o join enrollments e on e.id=o.aggregate_id join sequence_versions v on v.id=e.sequence_version_id where v.sequence_id=$1',
        [row.id],
      ),
    ]);
    if ((realRuns.rows[0]?.count ?? 0) > 0 || (sends.rows[0]?.count ?? 0) > 0 || (queued.rows[0]?.count ?? 0) > 0) {
      throw new Error(`Refusing to remove ${row.name}: it has a non-demo run, send, or queued work`);
    }
    await client.query(
      "delete from enrollments e using sequence_versions v where e.sequence_version_id=v.id and v.sequence_id=$1 and e.input->>'demo'='true'",
      [row.id],
    );
    await client.query('delete from sequence_versions where sequence_id=$1', [row.id]);
    await client.query('delete from sequences where id=$1', [row.id]);
  }
  if (legacy.rowCount) {
    await client.query(
      "delete from contacts c where c.workspace_id=$1 and c.external_id=any($2::text[]) and c.fields->>'demo'='true' and not exists (select 1 from enrollments e where e.contact_id=c.id)",
      [workspaceId, ['demo-ava', 'demo-noah', 'demo-mia']],
    );
  }
  return legacy.rowCount ?? 0;
}

async function ensureTemplates(client: PoolClient, workspaceId: string): Promise<DemoTemplateVersions> {
  const versions = {} as DemoTemplateVersions;
  for (const template of demoTemplates) {
    const existing = await client.query<{ id: string; state: string; demo: boolean }>(
      "select id, state, (props_schema->>'demoFixtureVersion')='2' as demo from templates where workspace_id=$1 and name=$2",
      [workspaceId, template.name],
    );
    if (existing.rows[0] && (!existing.rows[0].demo || existing.rows[0].state !== 'published')) {
      throw new Error(`Refusing to replace a non-demo or archived template: ${template.name}`);
    }
    const html = htmlFor(template.body);
    const propsSchema = { demoFixtureVersion: 2 };
    const inserted = await client.query<{ id: string }>(
      `insert into templates (workspace_id, name, state, subject, preheader, body, html, source_kind, props_schema)
       values ($1,$2,'published',$3,$4,$5,$6,'html',$7::jsonb)
       on conflict (workspace_id,name) do nothing returning id`,
      [workspaceId, template.name, template.subject, template.preheader, template.body, html, JSON.stringify(propsSchema)],
    );
    const templateId = inserted.rows[0]?.id ?? existing.rows[0]?.id;
    if (!templateId) throw new Error(`Could not resolve template: ${template.name}`);
    const contentHash = hash({ subject: template.subject, preheader: template.preheader, body: template.body, html, sourceKind: 'html', propsSchema });
    const published = await client.query<{ id: string }>(
      `insert into template_versions (workspace_id, template_id, version, content_hash, subject, preheader, body, html, source_kind, props_schema)
       values ($1,$2,1,$3,$4,$5,$6,$7,'html',$8::jsonb)
       on conflict (template_id,version) do nothing returning id`,
      [workspaceId, templateId, contentHash, template.subject, template.preheader, template.body, html, JSON.stringify(propsSchema)],
    );
    const existingVersion = published.rows[0] ? null : await client.query<{ id: string }>(
      'select id from template_versions where template_id=$1 and version=1', [templateId],
    );
    const versionId = published.rows[0]?.id ?? existingVersion?.rows[0]?.id;
    if (!versionId) throw new Error(`Could not resolve template version: ${template.name}`);
    versions[template.key as DemoTemplateKey] = versionId;
  }
  return versions;
}

async function ensureJourneys(
  client: PoolClient,
  workspaceId: string,
  versions: DemoTemplateVersions,
): Promise<Map<string, JourneyPin>> {
  const pins = new Map<string, JourneyPin>();
  const eventSchema = JSON.stringify({ type: 'object', additionalProperties: true });
  for (const eventType of ['project.created.v1', 'teammate.invited.v1', 'workspace.active.v1', 'subscription.activated.v1', 'session.started.v1']) {
    await client.query(
      `insert into event_types (workspace_id, event_type, schema)
       values ($1,$2,$3::jsonb)
       on conflict (workspace_id,event_type) do nothing`,
      [workspaceId, eventType, eventSchema],
    );
  }
  for (const journey of demoJourneys(versions)) {
    const validated = workflowDefinitionSchema.parse(journey.definition);
    validateActionNodes(validated.nodes);
    if (collectEmailSendTemplateRefs(validated).some((ref) => !Object.values(versions).includes(ref.templateVersionId ?? ''))) {
      throw new Error(`A template pin is missing from ${journey.name}`);
    }
    simulateWorkflow(validated, { firstName: 'Ava', hasUnfinishedWork: true }, {}, []);
    simulateWorkflow(validated, { firstName: 'Ava', hasUnfinishedWork: false }, {}, [
      'project.created.v1', 'teammate.invited.v1', 'workspace.active.v1', 'subscription.activated.v1', 'session.started.v1',
    ].map((eventType) => ({ eventType, data: {} })));
    const definition = { ...validated, demoFixtureVersion: 2, demoIntent: journey.intent };
    const existing = await client.query<{ id: string; demo: boolean }>(
      "select id, (definition->>'demoFixtureVersion')='2' as demo from sequences where workspace_id=$1 and name=$2",
      [workspaceId, journey.name],
    );
    if (existing.rows[0] && !existing.rows[0].demo) throw new Error(`Refusing to replace a non-demo workflow: ${journey.name}`);
    const inserted = await client.query<{ id: string }>(
      `insert into sequences (workspace_id, name, state, definition)
       values ($1,$2,'draft',$3::jsonb)
       on conflict (workspace_id,name) do nothing
       returning id`,
      [workspaceId, journey.name, JSON.stringify(definition)],
    );
    const sequenceId = inserted.rows[0]?.id ?? existing.rows[0]?.id;
    if (!sequenceId) throw new Error(`Could not resolve journey: ${journey.name}`);
    if (!inserted.rows[0]) {
      await client.query(
        `update sequences set definition=$3::jsonb, updated_at=now()
         where id=$1 and workspace_id=$2 and (definition->>'demoFixtureVersion')='2'`,
        [sequenceId, workspaceId, JSON.stringify(definition)],
      );
    }

    const contentHash = hash(definition);
    const versionInsert = await client.query<{ id: string }>(
      `insert into sequence_versions (workspace_id, sequence_id, version, content_hash, definition)
       values ($1,$2,1,$3,$4::jsonb)
       on conflict (sequence_id,version) do nothing
       returning id`,
      [workspaceId, sequenceId, contentHash, JSON.stringify(definition)],
    );
    if (!versionInsert.rows[0]) {
      await client.query(
        `update sequence_versions set content_hash=$3, definition=$4::jsonb
         where sequence_id=$1 and version=1 and workspace_id=$2`,
        [sequenceId, workspaceId, contentHash, JSON.stringify(definition)],
      );
    }
    const version = versionInsert.rows[0]
      ?? (await client.query<{ id: string }>('select id from sequence_versions where sequence_id=$1 and version=1', [sequenceId])).rows[0];
    if (!version) throw new Error(`Could not resolve sequence version: ${journey.name}`);
    pins.set(journey.name, { sequenceId, versionId: version.id });
  }
  return pins;
}

async function clearDemoPeople(client: PoolClient, workspaceId: string, pins: Map<string, JourneyPin>): Promise<void> {
  const sequenceIds = [...pins.values()].map((pin) => pin.sequenceId);
  if (sequenceIds.length === 0) return;

  const realRuns = await client.query<{ count: number }>(
    `select count(*)::int as count
     from enrollments e
     join sequence_versions v on v.id=e.sequence_version_id
     where v.sequence_id=any($1::uuid[]) and e.input->>'demo' is distinct from 'true'`,
    [sequenceIds],
  );
  if ((realRuns.rows[0]?.count ?? 0) > 0) {
    throw new Error('Refusing to refresh demo people: a demo journey already has a non-demo enrollment');
  }

  const sends = await client.query<{ count: number }>(
    `select count(*)::int as count
     from send_intents s
     join enrollments e on e.id=s.enrollment_id
     join sequence_versions v on v.id=e.sequence_version_id
     where v.sequence_id=any($1::uuid[])`,
    [sequenceIds],
  );
  const queued = await client.query<{ count: number }>(
    `select count(*)::int as count
     from outbox o
     join enrollments e on e.id=o.aggregate_id
     join sequence_versions v on v.id=e.sequence_version_id
     where v.sequence_id=any($1::uuid[])`,
    [sequenceIds],
  );
  if ((sends.rows[0]?.count ?? 0) > 0 || (queued.rows[0]?.count ?? 0) > 0) {
    throw new Error('Refusing to refresh demo people: a demo journey has send or queued work');
  }

  await client.query(
    `delete from enrollments e
     using sequence_versions v
     where e.sequence_version_id=v.id
       and v.sequence_id=any($1::uuid[])
       and e.input->>'demo'='true'`,
    [sequenceIds],
  );
  await client.query(
    `delete from contacts c
     where c.workspace_id=$1
       and c.external_id=any($2::text[])
       and c.fields->>'demo'='true'
       and not exists (select 1 from enrollments e where e.contact_id=c.id)`,
    [workspaceId, demoExternalIds],
  );
}

async function ensurePeople(client: PoolClient, workspaceId: string, pins: Map<string, JourneyPin>): Promise<number> {
  await clearDemoPeople(client, workspaceId, pins);
  let created = 0;

  for (const person of demoPeople) {
    const pin = pins.get(person.journeyName);
    if (!pin) throw new Error(`No journey pin for ${person.journeyName}`);

    const emailKey = person.email.trim().toLowerCase();
    const contactInsert = await client.query<{ id: string }>(
      `insert into contacts (workspace_id, external_id, email, email_key, fields, created_at, updated_at)
       values ($1,$2,$3,$4,$5::jsonb,$6,$6)
       on conflict (workspace_id, email_key) do update
         set external_id=excluded.external_id,
             fields=excluded.fields,
             updated_at=excluded.updated_at
       where contacts.fields->>'demo'='true'
       returning id`,
      [workspaceId, person.externalId, person.email, emailKey, JSON.stringify(person.fields), hoursAgo(person.hoursAgo)],
    );
    let contactId = contactInsert.rows[0]?.id;
    if (!contactId) {
      const existing = await client.query<{ id: string; demo: boolean }>(
        "select id, (fields->>'demo')='true' as demo from contacts where workspace_id=$1 and email_key=$2",
        [workspaceId, emailKey],
      );
      if (!existing.rows[0]?.demo) {
        throw new Error(`Refusing to overwrite a non-demo contact: ${person.email}`);
      }
      contactId = existing.rows[0].id;
    }

    const enrollmentId = randomUUID();
    const started = hoursAgo(person.hoursAgo);
    await client.query(
      `insert into enrollments (
         id, workspace_id, sequence_version_id, contact_id, state, current_step_id,
         workflow_id, input, idempotency_key, created_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$10)`,
      [
        enrollmentId,
        workspaceId,
        pin.versionId,
        contactId,
        person.state,
        person.currentStepId,
        demoWorkflowId(workspaceId, person.externalId),
        JSON.stringify({ demo: true, demoFixtureVersion: 2 }),
        `demo:${person.externalId}:${person.journeyName}`,
        started,
      ],
    );

    for (const [index, eventType] of person.events.entries()) {
      const receivedAt = hoursAgo(Math.max(1, person.hoursAgo - (index + 1) * 6));
      await client.query(
        `insert into enrollment_events (
           workspace_id, enrollment_id, event_id, event_type, data, payload_hash, delivered_at, created_at, updated_at
         ) values ($1,$2,$3,$4,'{}'::jsonb,$5,$6,$6,$6)`,
        [
          workspaceId,
          enrollmentId,
          `demo:${person.externalId}:${eventType}`,
          eventType,
          hash({ eventType, data: {} }),
          receivedAt,
        ],
      );
    }
    created += 1;
  }

  return created;
}

try {
  if (listing) {
    const rows = await pool.query<{ slug: string; name: string }>('select slug, name from workspaces order by created_at desc');
    for (const row of rows.rows) console.log(`${row.slug}  ${row.name}`);
  } else {
    for (const slug of new Set(slugs)) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const workspace = await client.query<{ id: string }>('select id from workspaces where slug=$1', [slug]);
        if (!workspace.rows[0]) throw new Error(`Local workspace not found: ${slug}`);
        const removed = await removeLegacyFixtures(client, workspace.rows[0].id);
        const versions = await ensureTemplates(client, workspace.rows[0].id);
        const pins = await ensureJourneys(client, workspace.rows[0].id, versions);
        const people = await ensurePeople(client, workspace.rows[0].id, pins);
        await client.query('commit');
        console.log(
          `${slug}: replaced ${removed} old placeholders; verified 3 detailed draft journeys, 8 preview templates, and ${people} demo people. No Temporal jobs or email sends created.`,
        );
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }
  }
} finally {
  await pool.end();
}
