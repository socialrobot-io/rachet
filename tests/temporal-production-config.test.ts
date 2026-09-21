import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('production Temporal packaging', () => {
  it('uses the persistent server stack and a prebuilt workflow bundle', async () => {
    const [compose, temporalImage, dynamicConfig, worker, image, pkg] = await Promise.all([
      readFile('compose.yaml', 'utf8'),
      readFile('docker/temporal/server.Dockerfile', 'utf8'),
      readFile('docker/temporal/dynamicconfig/production-sql.yaml', 'utf8'),
      readFile('apps/server/src/worker.ts', 'utf8'),
      readFile('Dockerfile', 'utf8'),
      readFile('package.json', 'utf8'),
    ]);
    expect(compose).toContain('NODE_ENV: production');
    expect(compose).toContain('DYNAMIC_CONFIG_FILE_PATH: config/dynamicconfig/production-sql.yaml');
    expect(compose).toContain('temporal-db:/var/lib/postgresql/data');
    expect(temporalImage).toMatch(/FROM temporalio\/server:\d/);
    expect(compose).not.toContain('temporal server start-dev');
    expect(dynamicConfig).not.toContain('system.forceSearchAttributesCacheRefreshOnRead:');
    expect(worker).toContain('workflowBundle:');
    expect(worker).not.toContain('workflowsPath:');
    expect(image).toContain('/app/dist ./dist');
    const dependencies = (JSON.parse(pkg) as { dependencies: Record<string, string> }).dependencies;
    const temporalVersions = Object.entries(dependencies).filter(([name]) => name.startsWith('@temporalio/')).map(([, version]) => version);
    expect(new Set(temporalVersions).size).toBe(1);
  });
});
