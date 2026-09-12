import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const composeFile = join(root, 'docker-compose.yml');
const hostedFile = join(root, 'docker-compose.hosted.yml');
const dockerfile = join(root, 'Dockerfile');
const deploymentDoc = join(root, 'docs/DOCKER_DEPLOYMENT.md');
const backupDoc = join(root, 'docs/DOCKER_VOLUME_BACKUP.md');

const read = (path: string): string => readFileSync(path, 'utf8');

const composeAvailable = (): boolean => {
  const result = spawnSync('docker', ['compose', 'version'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  return result.error === undefined && result.status === 0;
};

describe('docker compose guardrails', () => {
  it('pins the Node base image by digest and copies the healthcheck script', () => {
    const contents = read(dockerfile);
    expect(contents).toMatch(
      /FROM node:22-bookworm-slim@sha256:[a-f0-9]{64} AS build/,
    );
    expect(contents).toMatch(
      /FROM node:22-bookworm-slim@sha256:[a-f0-9]{64} AS runtime/,
    );
    expect(contents).toContain('scripts/docker-healthcheck.mjs');
    expect(contents).toContain('JARVIS_VERSION');
    expect(contents).toContain('JARVIS_COMMIT_SHA');
  });

  it('keeps a single-replica local default without env_file or published ports', () => {
    const contents = read(composeFile);
    expect(contents).not.toMatch(/^\s*env_file:/m);
    expect(contents).not.toMatch(/^\s*ports:/m);
    expect(contents).not.toMatch(/^\s+ollama:/m);
    expect(contents).toContain('container_name: jarvis');
    expect(contents).toMatch(/replicas:\s*1/);
    expect(contents).toMatch(/--scale/);
    expect(contents).toContain('pids_limit:');
    expect(contents).toContain('json-file');
    expect(contents).toContain('max-size:');
    expect(contents).toContain('max-file:');
    expect(contents).toContain('scripts/docker-healthcheck.mjs');
    expect(contents).toContain('host.docker.internal:host-gateway');
    expect(contents).toMatch(/AI_PROVIDER=.*ollama/);
    expect(contents).toContain('host.docker.internal:11434');
    expect(contents).toContain(
      'jarvis-discord-bot:${JARVIS_COMMIT_SHA:-local}',
    );
    expect(contents).toContain('JARVIS_VERSION');
    expect(contents).toContain('JARVIS_COMMIT_SHA');
  });

  it('provides a hosted OpenAI overlay without extra_hosts or Ollama variables', () => {
    const contents = read(hostedFile);
    expect(contents).toContain('AI_PROVIDER=openai');
    expect(contents).toMatch(/extra_hosts:\s*!reset/);
    const environmentKeys = contents
      .split('\n')
      .filter((line) => /^\s+-\s+[A-Z0-9_]+=?/.test(line))
      .join('\n');
    expect(environmentKeys).not.toMatch(/OLLAMA_/);
    expect(environmentKeys).not.toMatch(/host\.docker\.internal/);
    expect(contents).not.toMatch(/^\s*env_file:/m);
    expect(contents).not.toMatch(/^\s*ports:/m);
    expect(contents).not.toMatch(/^\s+ollama:/m);
  });

  it('documents Linux Compose, replica safety, register-commands, and backups', () => {
    const deployment = read(deploymentDoc);
    const backup = read(backupDoc);
    expect(deployment).toMatch(/Linux/);
    expect(deployment).toMatch(/never[\s\S]{0,40}--scale/i);
    expect(deployment).toMatch(/lease-fencing/i);
    expect(deployment).toMatch(/register-commands/);
    expect(deployment).toMatch(/loopback/i);
    expect(deployment).toMatch(/network_mode:\s*service:jarvis|netns/i);
    expect(deployment).toMatch(/down --volumes/);
    expect(backup).toMatch(/jarvis-data/);
    expect(backup).toMatch(/docker compose stop jarvis/);
    expect(backup).toMatch(/tar/);
    expect(backup).toMatch(/Litestream/);
    expect(backup).toMatch(/one writer/i);
    expect(backup).toMatch(/exactly one replica/i);
  });

  it.skipIf(!composeAvailable())(
    'renders local and hosted compose config without a repo-local .env',
    () => {
      const local = spawnSync('docker', ['compose', 'config'], {
        cwd: root,
        encoding: 'utf8',
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
        timeout: 30_000,
      });
      expect(local.status, local.stderr).toBe(0);
      expect(local.stdout).toContain('container_name: jarvis');
      expect(local.stdout).not.toMatch(/^\s*ports:/m);

      const hosted = spawnSync(
        'docker',
        [
          'compose',
          '-f',
          'docker-compose.yml',
          '-f',
          'docker-compose.hosted.yml',
          'config',
        ],
        {
          cwd: root,
          encoding: 'utf8',
          env: { PATH: process.env.PATH, HOME: process.env.HOME },
          timeout: 30_000,
        },
      );
      expect(hosted.status, hosted.stderr).toBe(0);
      expect(hosted.stdout).toMatch(/AI_PROVIDER:\s*openai/);
      expect(hosted.stdout).not.toMatch(/OLLAMA_/);
      expect(hosted.stdout).not.toMatch(/host\.docker\.internal/);
      expect(hosted.stdout).not.toMatch(/^\s*ports:/m);
    },
  );
});
