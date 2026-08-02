export interface RuntimeIdentity {
  readonly version: string;
  readonly commit: string;
  readonly builtAt: string;
  readonly environment: string;
}

const safeValue = (value: string | undefined, fallback: string): string => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' || trimmed.length > 128 ? fallback : trimmed;
};

export const loadRuntimeIdentity = (
  env: NodeJS.ProcessEnv,
  packageVersion: string,
): RuntimeIdentity =>
  Object.freeze({
    version: safeValue(env.JARVIS_VERSION, packageVersion),
    commit: safeValue(env.JARVIS_COMMIT_SHA, 'development'),
    builtAt: safeValue(env.JARVIS_BUILD_TIMESTAMP, 'unknown'),
    environment: safeValue(env.JARVIS_ENVIRONMENT, 'development'),
  });

export const formatRuntimeIdentity = (identity: RuntimeIdentity): string =>
  `Jarvis ${identity.version} (${identity.environment}, commit ${identity.commit}, built ${identity.builtAt}).`;
