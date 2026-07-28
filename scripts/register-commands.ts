import dotenv from 'dotenv';
import { REST, Routes } from 'discord.js';
import { createCommandDefinitions } from '../src/commands/definitions.js';
import { loadConfig } from '../src/config/config.js';

const registerCommands = async (): Promise<void> => {
  dotenv.config();
  const config = loadConfig(process.env);
  const rest = new REST({ version: '10' }).setToken(config.discord.token);

  await rest.put(
    Routes.applicationGuildCommands(
      config.discord.clientId,
      config.discord.guildId,
    ),
    { body: createCommandDefinitions(config.security.maxInputChars) },
  );
};

void registerCommands();
