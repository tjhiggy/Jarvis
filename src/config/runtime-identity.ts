import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const packageVersion = (): string => {
  try {
    const metadata = require('../../package.json') as { version?: unknown };
    return typeof metadata.version === 'string' &&
      metadata.version.trim() !== ''
      ? metadata.version.trim()
      : '0.0.0-development';
  } catch {
    return '0.0.0-development';
  }
};

export interface RuntimeIdentity {
  readonly version: string;
  readonly commit: string;
  readonly builtAt: string;
  readonly environment: string;
}

const safeValue = (value: string | undefined, fallback: string): string => {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '' || trimmed.length > 128) return fallback;
  // eslint-disable-next-line no-control-regex -- Reject control bytes in operator-supplied release metadata.
  const sanitized = trimmed.replace(/[\u0000-\u001f\u007f]/g, '');
  return sanitized === '' ? fallback : sanitized;
};

export const loadApplicationVersion = (): string => packageVersion();

export const loadRuntimeIdentity = (
  env: NodeJS.ProcessEnv,
  fallbackVersion = packageVersion(),
): RuntimeIdentity =>
  Object.freeze({
    version: safeValue(env.JARVIS_VERSION, fallbackVersion),
    commit: safeValue(env.JARVIS_COMMIT_SHA, 'development'),
    builtAt: safeValue(env.JARVIS_BUILD_TIMESTAMP, 'unknown'),
    environment: safeValue(env.JARVIS_ENVIRONMENT, 'development'),
  });

export const formatRuntimeIdentity = (identity: RuntimeIdentity): string =>
  `Jarvis ${identity.version} (${identity.environment}, commit ${identity.commit}, built ${identity.builtAt}).`;
