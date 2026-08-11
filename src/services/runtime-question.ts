import type { RuntimeIdentity } from '../config/runtime-identity.js';

const runtimeQuestion =
  /\b(version|build|release|commit|deployment|running|operating system|os|host|machine|hardware|uptime|model|upgrade(?:s|d)?|changed|changes)\b/i;
const selfReference =
  /\b(jarvis|mutha\s*ship|ship diagnostics|you|your|you're|are you)\b/i;

export const classifyRuntimeQuestion = (
  prompt: string,
  identity: RuntimeIdentity | undefined,
): string | undefined => {
  if (!runtimeQuestion.test(prompt) || !selfReference.test(prompt)) {
    return undefined;
  }

  if (
    /\b(version|build|release|commit|deployment|upgrade(?:s|d)?|changed|changes)\b/i.test(
      prompt,
    )
  ) {
    return identity === undefined
      ? 'Jarvis runtime identity is not available in this deployment. I will not guess.'
      : `This MuthaShip is running Jarvis ${identity.version}, deployment ${identity.environment}, commit ${identity.commit}, built ${identity.builtAt}.`;
  }

  if (/\b(model)\b/i.test(prompt)) {
    return 'My model identity is not exposed through the trusted runtime status channel. I will not guess.';
  }

  return 'Ship diagnostics cannot inspect the host operating system or hardware. An administrator can check the MuthaShip host directly, but I will not infer private runtime details.';
};
