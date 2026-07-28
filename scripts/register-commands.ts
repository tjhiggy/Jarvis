import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { REST, Routes } from 'discord.js';
import { createCommandDefinitions } from '../src/commands/definitions.js';
import { loadDiscordRegistrationConfig } from '../src/config/config.js';

interface RegistrationClient {
  put(
    route: string,
    options: Readonly<{ body: readonly unknown[] }>,
  ): Promise<unknown>;
}

export interface RegisterCommandsDependencies {
  readonly env?: NodeJS.ProcessEnv;
  readonly loadEnvironment?: () => unknown;
  readonly createClient?: (token: string) => RegistrationClient;
}

export const registerCommands = async (
  dependencies: RegisterCommandsDependencies = {},
): Promise<void> => {
  (dependencies.loadEnvironment ?? (() => dotenv.config()))();
  const config = loadDiscordRegistrationConfig(dependencies.env ?? process.env);
  const rest =
    dependencies.createClient?.(config.token) ??
    new REST({ version: '10' }).setToken(config.token);

  await rest.put(
    Routes.applicationGuildCommands(config.clientId, config.guildId),
    { body: createCommandDefinitions(config.maxInputChars) },
  );
};

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  void registerCommands().catch(() => {
    process.stderr.write('Command registration failed.\n');
    process.exitCode = 1;
  });
}
