import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = resolve(root, 'packages/cli/package.json');
const artifactPath = resolve(root, 'packages/cli/dist/cli.js');
const packageMetadata = JSON.parse(await readFile(packagePath, 'utf8')) as { version: string };
const artifact = await readFile(artifactPath, 'utf8');
const requestedScopes = 'openid profile email offline_access rachet:read rachet:write rachet:send';

if (!artifact.includes(requestedScopes)) {
  throw new Error(`CLI artifact does not request the required OAuth scopes: ${requestedScopes}`);
}
if (/\breflow:(?:read|write|send)\b/.test(artifact)) {
  throw new Error('CLI artifact requests deprecated reflow:* OAuth scopes. Rebuild before publishing.');
}

const version = spawnSync(process.execPath, [artifactPath, '--version'], { encoding: 'utf8' });
if (version.error) throw version.error;
if (version.status !== 0) throw new Error(`CLI version check failed: ${version.stderr.trim()}`);
if (version.stdout.trim() !== packageMetadata.version) {
  throw new Error(`CLI artifact reports ${version.stdout.trim() || 'no version'}, expected ${packageMetadata.version}. Rebuild before publishing.`);
}
