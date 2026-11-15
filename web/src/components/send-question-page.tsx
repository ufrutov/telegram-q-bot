import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ExternalLink,
  Hash,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  Shuffle,
  X,
} from "lucide-react";
import { api } from "../auth";
import type {
  ChatPage,
  DashboardChat,
  QuestionDelivery,
  QuestionDeliveryResult,
  QuestionDraft,
} from "../../../src/types/dashboard";
import { TelegramMarkdown } from "./telegram-markdown";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";

type Draft = QuestionDraft & { draftId: string };
type Delivery = QuestionDelivery & { title: string };
const LIMIT = 10;

export function SendQuestionPage() {
  const client = useQueryClient();
  const [mode, setMode] = useState<"random" | "id">("random");
  const [questionId, setQuestionId] = useState("");
  const [complexity, setComplexity] = useState<QuestionDraft["complexity"]>("random");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const busyRef = useRef(false);
  const [loadError, setLoadError] = useState("");
  const [sendError, setSendError] = useState("");
  const [selected, setSelected] = useState(new Map<string, DashboardChat>());
  const [deliveries, setDeliveries] = useState(new Map<string, Delivery>());
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(0);
  const recipients = useQuery({
    queryKey: ["send-recipients", appliedSearch, page],
    queryFn: ({ signal }) =>
      api<ChatPage>(
        { resource: "chats", search: appliedSearch, page: String(page), sort: "title" },
        signal,
      ),
    placeholderData: keepPreviousData,
  });
  async function load(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setLoadError("");
    try {
      const value = await api<QuestionDraft>({ resource: "send-question" }, undefined, {
        method: "POST",
        body: {
          action: "load",
          complexity,
          ...(mode === "id" ? { questionId: questionId.trim() } : {}),
        },
      });
      setDraft({ ...value, draftId: crypto.randomUUID() });
      setDeliveries(new Map());
      setSendError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load the question.");
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  }
  function toggle(chat: DashboardChat) {
    if (sending) return;
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(chat.id)) next.delete(chat.id);
      else if (next.size < LIMIT) next.set(chat.id, chat);
      return next;
    });
  }
  const unsent = [...selected.values()].filter((chat) => !deliveries.has(chat.id));
  async function send() {
    if (!draft || !unsent.length || busyRef.current) return;
    busyRef.current = true;
    setSending(true);
    setSendError("");
    const targets = [...unsent];
    try {
      const response = await api<QuestionDeliveryResult>({ resource: "send-question" }, undefined, {
        method: "POST",
        body: {
          action: "send",
          questionId: draft.id,
          complexity: draft.complexity,
          draftId: draft.draftId,
          chatIds: targets.map((chat) => chat.id),
        },
      });
      setDeliveries((current) => {
        const next = new Map(current);
        for (const result of response.results)
          next.set(result.chatRowId, {
            ...result,
            title: selected.get(result.chatRowId)?.title || "Unnamed chat",
          });
        return next;
      });
      await client.invalidateQueries();
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Delivery could not be confirmed.");
      // A failed HTTP response may follow a successful Telegram send. Never retry automatically.
      setDeliveries((current) => {
        const next = new Map(current);
        for (const chat of targets)
          next.set(chat.id, {
            chatRowId: chat.id,
            title: chat.title || "Unnamed chat",
            status: "unknown",
            error: "Check Telegram before starting a new send.",
          });
        return next;
      });
    } finally {
      busyRef.current = false;
      setSending(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Send question</h1>
          <p>Preview a question, choose your chats, and send it when you’re ready.</p>
        </div>
        <Badge variant="outline">Manual delivery</Badge>
      </div>
      <div className="send-page-grid">
        <section className="send-compose" aria-label="Question selection and preview">
          <Card className="send-panel block gap-0 p-0">
            <div className="send-panel-heading">
              <span className="step-number">1</span>
              <div>
                <h2>Choose a question</h2>
                <p>Load a random question or enter a specific ID.</p>
              </div>
            </div>
            <form className="send-load-form" onSubmit={load}>
              <div className="send-mode" aria-label="Question source">
                <Button
                  type="button"
                  variant={mode === "random" ? "secondary" : "ghost"}
                  aria-pressed={mode === "random"}
                  disabled={loading || sending}
                  onClick={() => setMode("random")}
                >
                  <Shuffle size={15} />
                  Random question
                </Button>
                <Button
                  type="button"
                  variant={mode === "id" ? "secondary" : "ghost"}
                  aria-pressed={mode === "id"}
                  disabled={loading || sending}
                  onClick={() => setMode("id")}
                >
                  <Hash size={15} />
                  By question ID
                </Button>
              </div>
              <div className="send-load-fields">
                {mode === "id" && (
                  <div className="form-field">
                    <Label htmlFor="send-question-id">Question ID</Label>
                    <Input
                      id="send-question-id"
                      inputMode="numeric"
                      pattern="[0-9]+"
                      maxLength={15}
                      placeholder="e.g. 254609"
                      required
                      value={questionId}
                      onChange={(event) => setQuestionId(event.target.value)}
                      disabled={loading || sending}
                    />
                  </div>
                )}
                <div className="form-field">
                  <Label htmlFor="send-complexity">
                    {mode === "random" ? "Difficulty" : "Difficulty label"}
                  </Label>
                  <select
                    id="send-complexity"
                    value={complexity}
                    onChange={(event) =>
                      setComplexity(event.target.value as QuestionDraft["complexity"])
                    }
                    disabled={loading || sending}
                  >
                    <option value="random">Any difficulty</option>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
                <Button type="submit" variant="outline" disabled={loading || sending}>
                  {loading ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
                  {loading ? "Loading…" : draft ? "Load another question" : "Load question"}
                </Button>
              </div>
              {loadError && (
                <p className="field-error" role="alert">
                  {loadError}
                </p>
              )}
              <p className="send-helper">Loading a question does not send anything to Telegram.</p>
            </form>
          </Card>
          <Card className="send-panel send-preview block gap-0 p-0">
            <div className="send-panel-heading">
              <BookOpen size={18} />
              <div>
                <h2>Question preview</h2>
                <p>
                  {draft
                    ? `Question #${draft.id} · ${draft.complexity === "random" ? "Any difficulty" : draft.complexity}`
                    : "Your loaded question will appear here."}
                </p>
              </div>
              {draft && (
                <a
                  href={draft.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open question source"
                >
                  <ExternalLink size={16} />
                </a>
              )}
            </div>
            {draft ? (
              <div className="send-preview-content">
                <TelegramMarkdown text={draft.question} />
                {draft.attachments > 0 && (
                  <p className="send-helper">
                    Includes {draft.attachments} image attachment
                    {draft.attachments === 1 ? "" : "s"}. Images are included in the Telegram
                    message.
                  </p>
                )}
                <details className="send-answer">
                  <summary>
                    Show answer
                    <ChevronDown size={14} />
                  </summary>
                  <TelegramMarkdown text={draft.answer || "Answer text is unavailable."} />
                </details>
                <p className="send-helper">
                  The question includes an Answer button. The Hint button follows each chat’s
                  settings.
                </p>
              </div>
            ) : (
              <div className="empty">
                <BookOpen size={28} />
                <h3>No question loaded</h3>
                <p>Load a question to review it before sending.</p>
              </div>
            )}
          </Card>
        </section>
        <section aria-label="Recipient selection" className="send-recipients">
          <Card className="send-panel block gap-0 p-0">
            <div className="send-panel-heading">
              <span className="step-number">2</span>
              <div>
                <h2>Select chats</h2>
                <p>Select up to {LIMIT} chats or topics per send.</p>
              </div>
              <Badge variant="secondary">{selected.size} selected</Badge>
            </div>
            <form
              className="recipient-search"
              onSubmit={(event) => {
                event.preventDefault();
                setAppliedSearch(search);
                setPage(0);
              }}
            >
              <Search size={15} />
              <Input
                aria-label="Search recipient chats"
                className="pl-8"
                placeholder="Search title or Telegram ID"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                maxLength={100}
              />
              <Button type="submit" variant="outline" disabled={sending}>
                Search
              </Button>
            </form>
            {recipients.isError ? (
              <Alert variant="destructive" className="m-4 w-auto">
                <AlertDescription>{recipients.error.message}</AlertDescription>
                <Button variant="outline" onClick={() => recipients.refetch()}>
                  Try again
                </Button>
              </Alert>
            ) : recipients.isPending ? (
              <div className="loading" role="status">
                <LoaderCircle size={16} className="spin" />
                Loading chats…
              </div>
            ) : (
              <>
                <div className="recipient-list" aria-busy={recipients.isFetching}>
                  {recipients.data.items.length ? (
                    recipients.data.items.map((chat) => (
                      <label className="recipient-row" key={chat.id}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${chat.title || chat.chat_id}`}
                          checked={selected.has(chat.id)}
                          disabled={sending || (!selected.has(chat.id) && selected.size >= LIMIT)}
                          onChange={() => toggle(chat)}
                        />
                        <span className="chat-avatar">
                          <MessageSquare size={16} />
                        </span>
                        <span className="recipient-name">
                          <strong>{chat.title || "Unnamed chat"}</strong>
                          <span className="mono">
                            {chat.chat_id} ·{" "}
                            {chat.thread_id === null ? "Main chat" : `Chat topic ${chat.thread_id}`}
                          </span>
                        </span>
                        {!chat.is_active && <Badge variant="secondary">Inactive</Badge>}
                        {deliveries.get(chat.id)?.status === "sent" && (
                          <Check size={15} className="text-foreground" aria-label="Sent" />
                        )}
                      </label>
                    ))
                  ) : (
                    <div className="empty">
                      <h3>No chats found</h3>
                      <p>Try another search. Only registered chats can receive questions here.</p>
                    </div>
                  )}
                </div>
                <div className="recipient-pagination">
                  <span>{recipients.data.total} chats and topics</span>
                  <div>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      aria-label="Previous recipient page"
                      disabled={page === 0 || recipients.isFetching || sending}
                      onClick={() => setPage(page - 1)}
                    >
                      <ArrowLeft size={14} />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      aria-label="Next recipient page"
                      disabled={
                        (page + 1) * recipients.data.pageSize >= recipients.data.total ||
                        recipients.isFetching ||
                        sending
                      }
                      onClick={() => setPage(page + 1)}
                    >
                      <ArrowRight size={14} />
                    </Button>
                  </div>
                </div>
              </>
            )}
            {selected.size > 0 && (
              <div className="selected-recipients">
                <div>
                  <h3>Selected recipients</h3>
                  <Button variant="link" disabled={sending} onClick={() => setSelected(new Map())}>
                    Clear
                  </Button>
                </div>
                <div className="recipient-chips">
                  {[...selected.values()].map((chat) => (
                    <Badge key={chat.id} variant="secondary">
                      <span>
                        {chat.title || chat.chat_id}
                        {chat.thread_id !== null ? ` / Chat topic ${chat.thread_id}` : ""}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${chat.title || chat.chat_id}`}
                        disabled={sending}
                        onClick={() => toggle(chat)}
                      >
                        <X size={12} />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            <div className="send-submit">
              <p>
                {draft
                  ? `Question #${draft.id} will be sent to ${unsent.length} selected chat${unsent.length === 1 ? "" : "s"}.`
                  : "Load a question and select its recipients to continue."}
              </p>
              <Button
                className="w-full"
                disabled={!draft || !unsent.length || loading || sending}
                onClick={send}
              >
                {sending ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
                {sending
                  ? "Sending question…"
                  : `Send question${unsent.length ? ` to ${unsent.length} chat${unsent.length === 1 ? "" : "s"}` : ""}`}
              </Button>
              {sendError && (
                <p className="field-error" role="alert">
                  {sendError}
                </p>
              )}
            </div>
          </Card>
          {deliveries.size > 0 && (
            <Card className="send-results block gap-0 p-4">
              <h2>Delivery results</h2>
              <p className="send-helper">
                Question #{draft?.id}. Load a new preview to start another send.
              </p>
              <ul aria-live="polite">
                {[...deliveries.values()].map((result) => (
                  <li key={result.chatRowId}>
                    <div>
                      <strong>{result.title}</strong>
                      <Badge variant={result.status === "sent" ? "secondary" : "outline"}>
                        {
                          {
                            sent: "Sent",
                            failed: "Failed",
                            pending: "In progress",
                            unknown: "Unconfirmed",
                          }[result.status]
                        }
                      </Badge>
                    </div>
                    {result.error && <p>{result.error}</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      </div>
    </>
  );
}
