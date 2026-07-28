export const isAllowedChannel = (
  channelId: string,
  parentId: string | null | undefined,
  allowlist: ReadonlySet<string>,
): boolean => {
  if (allowlist.size === 0) {
    return true;
  }

  return (
    allowlist.has(channelId) ||
    (parentId !== null && parentId !== undefined && allowlist.has(parentId))
  );
};
