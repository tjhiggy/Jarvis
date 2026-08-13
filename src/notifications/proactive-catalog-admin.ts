import { buildProactiveCatalog, type ProactivePrompt } from './proactive-catalog.js';

export interface ProactiveCatalogAdmin {
  list(): readonly ProactivePrompt[];
  add(prompt: ProactivePrompt): readonly ProactivePrompt[];
  edit(id: string, patch: Partial<Pick<ProactivePrompt, 'category' | 'text' | 'active'>>): readonly ProactivePrompt[];
  setActive(id: string, active: boolean): readonly ProactivePrompt[];
  retire(id: string): readonly ProactivePrompt[];
}

export function createProactiveCatalogAdmin(initial: readonly ProactivePrompt[] = []): ProactiveCatalogAdmin {
  let catalog = buildProactiveCatalog(initial);
  const update = (next: readonly ProactivePrompt[]) => (catalog = buildProactiveCatalog(next));
  return {
    list: () => catalog,
    add: (prompt) => update([...catalog, prompt]),
    edit: (id, patch) => update(catalog.map((prompt) => prompt.id === id ? { ...prompt, ...patch } : prompt)),
    setActive: (id, active) => update(catalog.map((prompt) => prompt.id === id ? { ...prompt, active } : prompt)),
    retire: (id) => update(catalog.map((prompt) => prompt.id === id ? { ...prompt, active: false } : prompt)),
  };
}
