/** Window CustomEvent fired after settings are saved, so on-page components
 *  (the viewer orchestrator) can react mid-session without polling. Kept in
 *  its own module so both SettingsButton and ProviderSettings can import it
 *  without a circular dependency. */
export const SETTINGS_EVENT = "getit:settings";
