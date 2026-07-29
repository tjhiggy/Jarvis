export type ResponseStyle = 'concise-casual' | 'standard';

const detailSignal =
  /\b(?:explain|describe|walk me through|step by step|in detail|detailed|deep dive|comprehensive)\b/i;
const currentSubjectSignal =
  /\b(?:weather|forecast|news|price|cost|schedule|score|standings|law|legal|regulation|release|update|patch|version|event)\b/i;
const greetingSignal =
  /^(?:hey|hello|hi|good (?:morning|afternoon|evening))(?:\s+(?:jarvis|j\.?a\.?r\.?v\.?i\.?s\.?))?[!.?]*$/i;
const thanksSignal = /^(?:thanks|thank you|much appreciated)[!.?]*$/i;
const jokeSignal =
  /^(?:please\s+)?(?:tell|give)\s+me\s+(?:a|another)\s+joke[!.?]*$/i;
const emotionalCheckInSignal =
  /^(?:how are you|how are you feeling|how do you feel)(?:\s+(?:today|right now))?[!.?]*$/i;
const smallTalkSignal =
  /^(?:what(?:['’]s| is) up|how(?:['’]s| is) it going|how(?:['’]s| is) your day going|(?:so\s+)?what(?:['’]s| is) new with you(?:\s+(?:today|right now))?|anything new with you(?:\s+(?:today|right now))?)[!.?]*$/i;

export const isCasualConversationPrompt = (prompt: string): boolean => {
  const normalized = prompt
    .trim()
    .replace(/^[\s,.:;\-–—]+/u, '')
    .replace(/\s+/g, ' ');
  if (
    normalized === '' ||
    detailSignal.test(normalized) ||
    currentSubjectSignal.test(normalized)
  ) {
    return false;
  }
  return [
    greetingSignal,
    thanksSignal,
    jokeSignal,
    emotionalCheckInSignal,
    smallTalkSignal,
  ].some((signal) => signal.test(normalized));
};

export const classifyResponseStyle = (prompt: string): ResponseStyle =>
  isCasualConversationPrompt(prompt) ? 'concise-casual' : 'standard';
