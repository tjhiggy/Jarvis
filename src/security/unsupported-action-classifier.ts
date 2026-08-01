const reminderGuidance = 'Use /reminder set to create a personal reminder.';
const schedulingLimitation =
  'I cannot schedule alarms, timers, or future messages yet.';
const communicationLimitation =
  'I cannot place calls, send messages, or contact people.';
const executionLimitation =
  'I cannot execute code, commands, files, or repository changes.';
const systemChangeLimitation =
  'I cannot change Discord, accounts, settings, permissions, or external systems.';
const monitoringLimitation =
  'I cannot monitor, scan, track, or perform background work.';
const transactionLimitation =
  'I cannot make purchases, payments, orders, or financial transactions.';
const imageLimitation =
  'I cannot create or edit images yet. I can help design the prompt.';
const documentLimitation =
  'I cannot create, save, upload, or export files and documents yet. I can draft the content here.';
const mediaLimitation =
  'I cannot create or edit audio or video yet. I can help with a script, storyboard, or production plan.';
const attachmentLimitation =
  'I cannot read, analyze, convert, or transcribe attachments yet.';

const informationalRequest =
  /^(?:how|what|why|when|where|who|explain|describe|teach|show me how|can you explain|could you explain|help me understand)\b/i;
const draftingRequest =
  /^(?:draft|write|plan|outline|suggest|help me (?:draft|write|plan))\b/i;
const compositionalDraftRequest =
  /^(?:create|generate|make)\b.*\b(?:checklist|readme\s+draft|prompt)\b/i;
const politeActionPrefix =
  /^(?:please\s+)?(?:(?:can|could|will|would)\s+you\s+)?/i;

/**
 * Returns a local UX response for actions this release cannot perform.
 *
 * This classifier is not an authorization boundary, does not inspect Discord
 * permissions, and cannot grant or revoke any capability.
 */
export const classifyUnsupportedAction = (
  prompt: string,
): string | undefined => {
  const normalized = prompt.trim().replace(/\s+/g, ' ');
  if (normalized === '') {
    return undefined;
  }

  const action = normalized.replace(politeActionPrefix, '');

  if (
    informationalRequest.test(action) ||
    draftingRequest.test(action) ||
    compositionalDraftRequest.test(action)
  ) {
    return undefined;
  }

  if (
    /^(?:read|analyze|inspect|summarize|convert|transcribe)\b.*\b(?:attachment|attached|file|image|picture|photo|video|audio|pdf|document)\b/i.test(
      action,
    )
  ) {
    return attachmentLimitation;
  }

  if (
    /^(?:create|generate|make|render|edit|modify|upload|attach|save|export)\b.*\b(?:image|picture|photo|logo|icon|banner|artwork)\b/i.test(
      action,
    )
  ) {
    return imageLimitation;
  }

  if (
    /^(?:create|generate|make|render|edit|modify|upload|attach|save|export)\b.*\b(?:audio|video|movie|clip|animation|voice|song|music)\b/i.test(
      action,
    )
  ) {
    return mediaLimitation;
  }

  if (
    /^(?:create|generate|make|render|edit|modify|upload|attach|save|export)\b.*\b(?:file|document|pdf|spreadsheet|presentation|docx|xlsx|pptx)\b/i.test(
      action,
    )
  ) {
    return documentLimitation;
  }

  if (
    /\b(?:remind\s+me|set(?:\s+up)?\s+(?:(?:my|a|an|the)\s+)?reminder|schedule\s+(?:me\s+)?(?:(?:a|an|the)\s+)?reminder)\b/i.test(
      action,
    )
  ) {
    return reminderGuidance;
  }

  if (
    /\b(?:set(?:\s+up)?\s+(?:(?:my|a|an|the)\s+)?(?:alarm|timer)|start\s+(?:a\s+)?timer|schedule\s+(?:me\s+)?(?:(?:a|an|the)\s+)?(?:alarm|message|recap|post|event))\b/i.test(
      action,
    )
  ) {
    return schedulingLimitation;
  }

  if (
    /^schedule\s+(?:me\s+)?(?:(?:a|an|the)\s+)?(?:email|dm|text)\b/i.test(
      action,
    )
  ) {
    return communicationLimitation;
  }

  if (/^(?:call|phone|text|email|dm|message|contact|send)\b/i.test(action)) {
    return communicationLimitation;
  }

  if (
    /^(?:run|execute)\b.*\b(?:code|command|script|shell|terminal)\b/i.test(
      action,
    ) ||
    /^(?:edit|write|create|delete|remove|modify|change|update)\b.*\b(?:file|repository|repo|github)\b/i.test(
      action,
    )
  ) {
    return executionLimitation;
  }

  if (
    /^(?:edit|create|delete|remove|modify|change|update|configure|ban|kick|mute|erase|purge)\b.*\b(?:discord|channel|role|permission|account|setting|server|user|member)\b/i.test(
      action,
    )
  ) {
    return systemChangeLimitation;
  }

  if (/^(?:monitor|watch|scan|track)\b/i.test(action)) {
    return monitoringLimitation;
  }

  if (/^(?:buy|purchase|order|pay|transfer)\b/i.test(action)) {
    return transactionLimitation;
  }

  return undefined;
};
