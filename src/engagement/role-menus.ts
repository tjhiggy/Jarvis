export interface RoleMenuChoice {
  readonly value: string;
  readonly label: string;
  readonly roleId: string;
}

const snowflake = /^\d{17,20}$/;

/** Parse ROLE: label mappings supplied as value:label:roleId entries. */
export const parseRoleMenuConfig = (raw: string): readonly RoleMenuChoice[] => {
  const entries = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
  const seen = new Set<string>();
  return entries.map((entry) => {
    const parts = entry.split(':').map((part) => part.trim());
    if (parts.length !== 3) throw new Error('Role menu entries must be value:label:roleId.');
    const [value = '', label = '', roleId = ''] = parts;
    if (!value || !label || !snowflake.test(roleId) || seen.has(value)) {
      throw new Error('Role menu entries must contain unique values and valid Discord role IDs.');
    }
    seen.add(value);
    return { value, label, roleId };
  });
};

export const roleMenuSelection = (
  choices: readonly RoleMenuChoice[],
  value: string,
): RoleMenuChoice | undefined => choices.find((choice) => choice.value === value);
