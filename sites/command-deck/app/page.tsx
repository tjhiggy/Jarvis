import { CommandDeckApp } from './command-deck-app';
import { loadCommandDeckPresentation } from './lib/load-command-deck-presentation';

export default async function Page() {
  const presentation = await loadCommandDeckPresentation();
  return <CommandDeckApp {...presentation} />;
}
