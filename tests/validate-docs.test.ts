import { execFile, spawnSync } from 'node:child_process';
import {
  chmod,
  copyFile,
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const executeFile = promisify(execFile);

function isPwshAvailable(): boolean {
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  return result.error === undefined && result.status === 0;
}

describe('documentation validation', () => {
  it.skipIf(!isPwshAvailable())(
    'reports a missing implementation status document without aborting validation',
    async () => {
      const repositoryRoot = await mkdtemp(
        resolve(tmpdir(), 'jarvis-docs-check-'),
      );
      const scriptsDirectory = join(repositoryRoot, 'scripts');
      const docsDirectory = join(repositoryRoot, 'docs');
      const commandDirectory = join(repositoryRoot, 'commands');
      const gitShimPath = join(
        commandDirectory,
        process.platform === 'win32' ? 'git.cmd' : 'git',
      );

      try {
        await Promise.all([
          mkdir(scriptsDirectory),
          mkdir(docsDirectory),
          mkdir(commandDirectory),
        ]);
        await Promise.all([
          copyFile(
            resolve(process.cwd(), 'scripts/validate-docs.ps1'),
            join(scriptsDirectory, 'validate-docs.ps1'),
          ),
          writeFile(join(repositoryRoot, '.env.example'), ''),
          writeFile(join(repositoryRoot, 'package.json'), '{"scripts":{}}\n'),
          writeFile(join(repositoryRoot, 'README.md'), ''),
          writeFile(join(docsDirectory, 'CONFIGURATION.md'), ''),
          writeFile(join(docsDirectory, 'DEVELOPMENT.md'), ''),
          writeFile(
            gitShimPath,
            process.platform === 'win32'
              ? '@echo off\r\necho README.md\r\necho docs/IMPLEMENTATION_STATUS.md\r\n'
              : '#!/bin/sh\nprintf "%s\\n" README.md docs/IMPLEMENTATION_STATUS.md\n',
          ),
        ]);
        if (process.platform !== 'win32') {
          await chmod(gitShimPath, 0o755);
        }

        await expect(
          executeFile(
            'pwsh',
            ['-NoProfile', '-File', 'scripts/validate-docs.ps1'],
            {
              cwd: repositoryRoot,
              env: {
                ...process.env,
                PATH: `${commandDirectory}${delimiter}${process.env.PATH ?? ''}`,
                Path: `${commandDirectory}${delimiter}${process.env.Path ?? ''}`,
              },
            },
          ),
        ).rejects.toMatchObject({
          code: 1,
          stderr: expect.stringContaining(
            'docs/IMPLEMENTATION_STATUS.md: required implementation status document is missing',
          ),
        });
      } finally {
        await rm(repositoryRoot, { force: true, recursive: true });
      }
    },
    15_000,
  );
});
