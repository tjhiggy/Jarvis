export interface AdminPostChannel {
  readonly id: string;
  readonly label: string;
}

export const resolveAdminPostChannels = async (
  channelIds: readonly string[],
  resolveLabel: (channelId: string) => Promise<string | undefined>,
): Promise<AdminPostChannel[]> =>
  Promise.all(
    channelIds.map(async (channelId, index) => {
      let resolvedLabel: string | undefined;
      try {
        resolvedLabel = await resolveLabel(channelId);
      } catch {
        resolvedLabel = undefined;
      }
      const label = resolvedLabel?.trim();
      return {
        id: channelId,
        label:
          label === undefined || label === ''
            ? `Approved channel ${index + 1}`
            : label,
      };
    }),
  );
