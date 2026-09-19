import { writeFile } from 'node:fs/promises';
import { bundleWorkflowCode } from '@temporalio/worker';

const bundle = await bundleWorkflowCode({ workflowsPath: new URL('../apps/server/src/temporal/workflows.ts', import.meta.url).pathname });
await writeFile(new URL('../dist/workflow-bundle.js', import.meta.url), bundle.code);
