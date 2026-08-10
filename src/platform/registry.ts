import type { PlatformModule } from './contracts.js';

export class PlatformModuleRegistry {
  private readonly modules = new Map<string, PlatformModule>();

  register(module: PlatformModule): void {
    if (this.modules.has(module.id)) {
      throw new Error(`Platform module already registered: ${module.id}`);
    }
    this.modules.set(module.id, module);
  }

  get(id: string): PlatformModule | undefined {
    return this.modules.get(id);
  }

  list(): readonly PlatformModule[] {
    return Object.freeze([...this.modules.values()]);
  }
}
