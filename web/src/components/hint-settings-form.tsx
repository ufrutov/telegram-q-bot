import { useEffect, useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import type {
  HintModelConfig,
  HintModelOption,
  HintProvider,
  HintSettings,
} from "../../../src/types/hintSettings";
import { api } from "../auth";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

const sources = {
  environment: "Server environment",
  bot: "Bot settings",
  "main-chat": "Main chat",
  chat: "This chat",
};
export function HintSettingsForm({ chatId }: { chatId?: string }) {
  const query = useQuery({
    queryKey: ["hint-settings", chatId ?? "bot"],
    queryFn: ({ signal }) =>
      api<HintSettings>({ resource: "hint-settings", ...(chatId ? { chatId } : {}) }, signal),
    refetchOnWindowFocus: false,
  });
  if (query.isPending)
    return (
      <p className="hint-status" role="status">
        Loading hint configuration…
      </p>
    );
  if (query.isError)
    return (
      <div className="hint-status">
        <p role="alert">Could not load hint settings.</p>
        <Button variant="outline" onClick={() => query.refetch()}>
          Try again
        </Button>
      </div>
    );
  return <HintEditor chatId={chatId} settings={query.data} />;
}
function HintEditor({ chatId, settings }: { chatId?: string; settings: HintSettings }) {
  const client = useQueryClient();
  const id = useId();
  const [provider, setProvider] = useState<HintProvider | "inherit">("inherit");
  const [model, setModel] = useState("");
  const [overrideAll, setOverrideAll] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [testHint, setTestHint] = useState("");
  const [testError, setTestError] = useState("");
  const [question, setQuestion] = useState("Какой город называют городом на семи холмах?");
  const [answer, setAnswer] = useState("Рим");
  useEffect(() => {
    setProvider(settings.override?.provider ?? "inherit");
    setModel(settings.override?.model ?? "");
    setOverrideAll(settings.overrideAll);
    setTestHint("");
    setTestError("");
  }, [settings]);
  const configured =
    provider !== "inherit" && settings.providers.some((p) => p.id === provider && p.configured);
  const models = useQuery({
    queryKey: ["hint-models", provider],
    queryFn: ({ signal }) =>
      api<{ models: HintModelOption[] }>({ resource: "hint-models", provider }, signal),
    enabled: !!configured,
    staleTime: 300000,
    retry: false,
  });
  const locked = !!chatId && settings.overrideAll;
  const valid = provider === "inherit" || !!models.data?.models.some((value) => value.id === model);
  const config: HintModelConfig | null = provider === "inherit" ? null : { provider, model };
  const params: Record<string, string> = chatId ? { chatId } : {};
  async function save() {
    if (busy || !valid || locked || (!chatId && !settings.globalStorage)) return;
    setBusy("save");
    setError("");
    setSaved("");
    try {
      const value = await api<HintSettings>({ resource: "hint-settings", ...params }, undefined, {
        method: "PATCH",
        body: { config, overrideAll: chatId ? false : overrideAll },
      });
      client.setQueryData(["hint-settings", chatId ?? "bot"], value);
      await client.invalidateQueries({ queryKey: ["hint-settings"] });
      setSaved("Hint settings saved. New hint requests use this configuration.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save hint settings.");
    } finally {
      setBusy(null);
    }
  }
  async function test() {
    if (busy || (!locked && !valid) || !question.trim() || !answer.trim()) return;
    setBusy("test");
    setTestHint("");
    setTestError("");
    try {
      const value = await api<{ hint: string; provider: HintProvider; model: string }>(
        { resource: "hint-test", ...params },
        undefined,
        {
          method: "POST",
          body: {
            config: locked
              ? { provider: settings.effective.provider, model: settings.effective.model }
              : config,
            question,
            answer,
          },
        },
      );
      setTestHint(`${value.hint}\n\n${value.provider} · ${value.model}`);
    } catch (error) {
      setTestError(error instanceof Error ? error.message : "Could not generate a hint.");
    } finally {
      setBusy(null);
    }
  }
  function edited() {
    setSaved("");
    setError("");
    setTestHint("");
    setTestError("");
  }
  return (
    <div className="hint-settings" aria-busy={!!busy}>
      <div className="hint-effective">
        <span>Current effective model</span>
        <strong>{settings.effective.model}</strong>
        <span>
          {settings.effective.provider === "gemini" ? "Gemini" : "OpenRouter"} ·{" "}
          {sources[settings.effective.source]}
        </span>
      </div>
      {locked && (
        <p className="hint-note" role="status">
          Bot settings currently apply to every chat. Your saved override is preserved and will
          resume when that option is turned off.
        </p>
      )}
      {!chatId && !settings.globalStorage && (
        <p className="hint-note" role="status">
          Configure REDIS_URL on the server to save global settings. Environment defaults are
          currently in use.
        </p>
      )}
      <div className="form-field">
        <Label htmlFor={`${id}-provider`}>Hint provider</Label>
        <select
          id={`${id}-provider`}
          value={provider}
          disabled={!!busy || locked}
          onChange={(event) => {
            setProvider(event.target.value as typeof provider);
            setModel("");
            edited();
          }}
        >
          <option value="inherit">
            {chatId ? "Use inherited configuration" : "Use environment defaults"}
          </option>
          {settings.providers.map((value) => (
            <option key={value.id} value={value.id} disabled={!value.configured}>
              {value.label}
              {value.configured ? "" : " (API key not configured)"}
            </option>
          ))}
        </select>
      </div>
      {provider !== "inherit" && (
        <div className="form-field">
          <Label htmlFor={`${id}-model`}>Hint model</Label>
          <select
            id={`${id}-model`}
            value={model}
            disabled={!!busy || locked || !configured || models.isPending || models.isError}
            onChange={(event) => {
              setModel(event.target.value);
              edited();
            }}
          >
            <option value="">
              {models.isPending && configured ? "Loading models…" : "Select a model"}
            </option>
            {model && !models.data?.models.some((value) => value.id === model) && (
              <option value={model} disabled>
                {model} (not in available models)
              </option>
            )}
            {models.data?.models.map((value) => (
              <option key={value.id} value={value.id}>
                {value.label}
              </option>
            ))}
          </select>
          {models.isError && configured && (
            <div>
              <p className="field-error" role="alert">
                {models.error.message}
              </p>
              <Button variant="outline" onClick={() => models.refetch()}>
                Reload models
              </Button>
            </div>
          )}
          {!configured && (
            <p className="hint-note">
              Configure this provider’s API key in the server environment.
            </p>
          )}
          {models.data && !models.data.models.length && (
            <p className="hint-note">
              No supported text-and-image hint models are available for this provider.
            </p>
          )}
        </div>
      )}
      {!chatId && (
        <div className="hint-all-toggle">
          <Label htmlFor={`${id}-all`} className="grid gap-2">
            <span>Apply to all chats</span>
            <span className="hint-note">
              Temporarily override chat and topic model choices. Their saved choices are kept.
            </span>
          </Label>
          <Switch
            id={`${id}-all`}
            aria-label="Apply to all chats"
            checked={overrideAll}
            disabled={!!busy || !settings.globalStorage}
            onCheckedChange={(value) => {
              setOverrideAll(value);
              edited();
            }}
          />
        </div>
      )}
      <p className="hint-note">
        {chatId
          ? "Inheritance: topic → main chat → Bot settings → environment. The Hints toggle still controls whether hints are enabled."
          : "This default is used by chats without an override. Enable Apply to all chats to use it everywhere."}
      </p>
      <Button
        variant="outline"
        disabled={!!busy || !valid || locked || (!chatId && !settings.globalStorage)}
        onClick={save}
      >
        {busy === "save" && <LoaderCircle className="spin" size={16} />}Save hint settings
      </Button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="hint-note" role="status">
          {saved}
        </p>
      )}
      <details className="hint-test">
        <summary>Test a hint</summary>
        <p className="hint-note">
          Tests the selected configuration without saving or sending Telegram messages. Uses the
          provider’s API quota.
        </p>
        <div className="form-field">
          <Label htmlFor={`${id}-question`}>Sample question</Label>
          <textarea
            id={`${id}-question`}
            className="announcement-input"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={2000}
            rows={3}
            disabled={!!busy}
          />
        </div>
        <div className="form-field">
          <Label htmlFor={`${id}-answer`}>Correct answer</Label>
          <Input
            id={`${id}-answer`}
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            maxLength={1000}
            disabled={!!busy}
          />
        </div>
        <Button
          variant="outline"
          disabled={!!busy || (!locked && !valid) || !question.trim() || !answer.trim()}
          onClick={test}
        >
          {busy === "test" && <LoaderCircle className="spin" size={16} />}Generate test hint
        </Button>
        {testError && (
          <p className="field-error" role="alert">
            {testError}
          </p>
        )}
        {testHint && (
          <p className="hint-test-result" role="status">
            {testHint}
          </p>
        )}
      </details>
    </div>
  );
}
