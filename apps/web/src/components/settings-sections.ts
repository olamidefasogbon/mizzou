// Settings dialog sections (P2-14). Pure module so node tests can pin the
// nav contract without pulling in React or CSS.
export type SettingsSection = 'general' | 'help' | 'legal';

/** Nav entries in display order. General is first because it is the default. */
export const SETTINGS_NAV: Array<{ id: SettingsSection; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'help', label: 'Help & support' },
  { id: 'legal', label: 'Legal & safety' },
];
