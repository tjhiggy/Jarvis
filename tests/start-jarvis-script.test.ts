import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface StartupDryRun {
  readonly EntryPoint: string;
  readonly NodeArguments?: readonly string[];
  readonly ProcessEntryPointPatterns?: readonly string[];
}

describe.runIf(process.platform === 'win32')('start-jarvis.ps1', () => {
  it('preserves a spaced entry-point path as one quoted Node argument', () => {
    const dryRun = runDryRun();

    expect(dryRun.EntryPoint).toContain(' ');
    expect(dryRun.NodeArguments).toEqual([`"${dryRun.EntryPoint}"`]);
  });

  it('matches both Windows and portable entry-point path separators', () => {
    const dryRun = runDryRun();
    const windowsEntryPoint = dryRun.EntryPoint.replaceAll('/', '\\');
    const portableEntryPoint = dryRun.EntryPoint.replaceAll('\\', '/');

    expect(dryRun.ProcessEntryPointPatterns).toEqual([
      `*"${windowsEntryPoint}"*`,
      `*"${portableEntryPoint}"*`,
    ]);
  });
});

function runDryRun(): StartupDryRun {
  const scriptPath = path.join(process.cwd(), 'scripts', 'start-jarvis.ps1');
  const output = execFileSync(
    'pwsh',
    ['-NoProfile', '-File', scriptPath, '-DryRun'],
    { encoding: 'utf8' },
  );
  return JSON.parse(output) as StartupDryRun;
}
