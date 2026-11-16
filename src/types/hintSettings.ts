/** Public hint configuration. API credentials never belong in these contracts. */
export type HintProvider = "gemini" | "openrouter";
export interface HintModelConfig {
  provider: HintProvider;
  model: string;
}
export interface EffectiveHintConfig extends HintModelConfig {
  source: "environment" | "bot" | "main-chat" | "chat";
}
export interface HintSettings {
  override: HintModelConfig | null;
  overrideAll: boolean;
  globalStorage: boolean;
  effective: EffectiveHintConfig;
  providers: Array<{ id: HintProvider; label: string; configured: boolean }>;
}
export interface HintModelOption {
  id: string;
  label: string;
}
