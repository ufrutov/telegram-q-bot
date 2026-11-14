import { Component, StrictMode, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
  useInfiniteQuery,
  keepPreviousData,
} from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  ExternalLink,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  MoreHorizontal,
  Settings2,
  CalendarClock,
  BookOpen,
  CircleCheck,
  Lightbulb,
  ChevronRight,
} from "lucide-react";
import { api, ApiError, supabase, useSession } from "./auth";
import { TelegramMarkdown } from "./components/telegram-markdown";
import { hasEmbeddedDescription } from "./lib/telegram-markdown";
import type {
  ChatDetail,
  ChatPage,
  DashboardChat,
  DashboardQuestion,
  QuestionDetail,
  QuestionPage,
  OverviewPage,
} from "../../src/types/dashboard";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Switch } from "./components/ui/switch";
import { Badge as UiBadge } from "./components/ui/badge";
import { Card } from "./components/ui/card";
import { Alert, AlertDescription } from "./components/ui/alert";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "./components/ui/table";
import { SendQuestionPage } from "./components/send-question-page";
import { AdminShell, ThemeToggle } from "./components/admin-shell";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "./components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "./components/ui/dropdown-menu";
import "./style.css";

function date(value: string | null, timezone?: string): string {
  if (!value) return "Never";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date(value));
  } catch {
    return "Unknown date";
  }
}
function StatusBadge({
  enabled,
  yes = "Enabled",
  no = "Disabled",
}: {
  enabled: boolean;
  yes?: string;
  no?: string;
}) {
  return (
    <UiBadge variant="outline" className={enabled ? "status-enabled" : "status-disabled"}>
      {enabled && <Check size={12} aria-hidden="true" />}
      {enabled ? yes : no}
    </UiBadge>
  );
}
function ErrorNotice({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <Alert variant="destructive" className="error">
      <AlertDescription>{error.message}</AlertDescription>
      {retry && (
        <Button variant="outline" onClick={retry}>
          Try again
        </Button>
      )}
    </Alert>
  );
}
function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <RefreshCw size={16} className="spin" aria-hidden="true" />
      {label}
    </div>
  );
}
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="auth">
        <h1>Something went wrong</h1>
        <p>Reload the dashboard to try again.</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </main>
    ) : (
      this.props.children
    );
  }
}
function Login({ initialError }: { initialError: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const email = String(fields.get("email")).trim();
    const password = String(fields.get("password"));
    if (mode === "signup" && password !== fields.get("confirm")) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result =
        mode === "signin"
          ? await supabase!.auth.signInWithPassword({ email, password })
          : await supabase!.auth.signUp({
              email,
              password,
              options: { emailRedirectTo: window.location.origin + "/" },
            });
      if (result.error) throw result.error;
      if (mode === "signup" && !result.data.session)
        setMessage("Check your email to confirm your account, then sign in.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to sign in. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <div className="login-theme">
        <ThemeToggle />
      </div>
      <div className="login-container">
        <a className="login-brand" href="/">
          <span className="workspace-logo">
            <MessageSquare size={20} />
          </span>
          <span>Question Bot</span>
        </a>
        <Card className="login-card block gap-0 p-7">
          <div className="login-heading">
            <h1>{mode === "signin" ? "Sign in to your dashboard" : "Create your account"}</h1>
            <p>
              {mode === "signin"
                ? "Enter your email and password to access your workspace."
                : "Enter your details to get started with Question Bot."}
            </p>
          </div>
          <form onSubmit={submit} className="login-fields">
            <div className="form-field">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                disabled={busy}
                placeholder="name@example.com"
              />
            </div>
            <div className="form-field">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                minLength={mode === "signup" ? 6 : undefined}
                required
                disabled={busy}
              />
            </div>
            {mode === "signup" && (
              <div className="form-field">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  disabled={busy}
                />
              </div>
            )}
            {error && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
            {message && (
              <p role="status" className="notice">
                {message}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
              <ArrowRight size={16} />
            </Button>
          </form>
          <div className="login-alternative">
            <span>{mode === "signin" ? "New to Question Bot?" : "Already have an account?"}</span>
            <Button
              variant="link"
              disabled={busy}
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError("");
                setMessage("");
              }}
            >
              {mode === "signin" ? "Create an account" : "Sign in"}
            </Button>
          </div>
        </Card>
        <p className="login-caption">
          <ShieldCheck size={14} />
          Secure sign-in with Supabase
        </p>
      </div>
    </main>
  );
}
function useLocation() {
  const [search, setSearch] = useState(window.location.search);
  useEffect(() => {
    const listener = () => setSearch(window.location.search);
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, []);
  const params = new URLSearchParams(search);
  function navigate(values: Record<string, string | null>) {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(values)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    const url = next.size ? `/?${next}` : "/";
    window.history.pushState(null, "", url);
    setSearch(window.location.search);
    window.scrollTo({ top: 0 });
  }
  return { params, navigate };
}
function ChatActions({
  chat,
  disabled,
  openChat,
}: {
  chat: DashboardChat;
  disabled: boolean;
  openChat?: () => void;
}) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  function show(remove = false) {
    setDeleting(remove);
    setConfirmation("");
    setMessage("");
    setError("");
    setOpen(true);
  }
  async function change(method: "PATCH" | "DELETE", body: unknown) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api({ resource: "chat", chatId: chat.id }, undefined, { method, body });
      if (method === "DELETE") setOpen(false);
      else setMessage("Changes saved.");
      await client.invalidateQueries();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to save changes.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            disabled={disabled || busy}
            aria-label={`Manage ${chat.title || "chat"}`}
          >
            <MoreHorizontal size={18} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Chat actions</DropdownMenuLabel>
          {openChat && (
            <DropdownMenuItem onSelect={openChat}>
              <MessageSquare />
              View chat & history
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => show()}>
            <Settings2 />
            Manage settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => show(true)}
          >
            <Trash2 />
            Delete chat
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Sheet
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <SheetContent className="chat-settings-sheet w-full sm:max-w-md">
          <SheetHeader className="p-4">
            <SheetTitle>{deleting ? "Delete chat" : "Chat settings"}</SheetTitle>
            <SheetDescription>Manage this chat and its bot interactions.</SheetDescription>
          </SheetHeader>
          <div className="settings-content px-4 pb-4">
            <div className="settings-chat">
              <span className="chat-avatar">
                <MessageSquare size={20} />
              </span>
              <div>
                <strong>{chat.title || "Unnamed chat"}</strong>
                <span className="sub mono">
                  {chat.chat_id}
                  {chat.thread_id !== null ? ` / Chat topic ${chat.thread_id}` : ""}
                </span>
              </div>
            </div>
            {!deleting ? (
              <>
                <h3 className="settings-section-title">Bot behavior</h3>
                <div className="settings-toggles">
                  {(
                    [
                      [
                        "cron_enabled",
                        "Daily question",
                        `Send a daily question at ${chat.cron_time.slice(0, 5)} (${chat.timezone}).`,
                      ],
                      ["commands_enabled", "Commands", "Respond to commands and menu actions."],
                      [
                        "answer_buttons_enabled",
                        "Answer buttons",
                        "Show Play pack and Count answer on answer messages.",
                      ],
                    ] as const
                  ).map(([field, label, description]) => (
                    <div className="settings-toggle" key={field}>
                      <Label className="grid gap-2" htmlFor={`${chat.id}-${field}`}>
                        <span>{label}</span>
                        <span>{description}</span>
                      </Label>
                      <Switch
                        id={`${chat.id}-${field}`}
                        aria-label={label}
                        checked={chat[field]}
                        disabled={busy || disabled}
                        onCheckedChange={(enabled) =>
                          change("PATCH", { action: "toggle", field, enabled })
                        }
                      />
                    </div>
                  ))}
                </div>
                <p className="notice">
                  {chat.thread_id === null
                    ? "Interaction restrictions on this row apply to every topic in the group."
                    : "Group-level restrictions can override these topic settings."}
                </p>
                {!chat.is_active && (
                  <p className="notice">
                    This chat is inactive. Daily questions will not be sent even if cron is enabled.
                  </p>
                )}
                <div className="settings-danger">
                  <h3>Delete chat</h3>
                  <p>Remove this row and its recorded history.</p>
                  <Button
                    variant="outline"
                    className="text-destructive"
                    disabled={busy}
                    onClick={() => setDeleting(true)}
                  >
                    <Trash2 size={15} />
                    Delete chat
                  </Button>
                </div>
              </>
            ) : (
              <form
                className="delete-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (confirmation === String(chat.chat_id))
                    change("DELETE", { action: "delete", confirmChatId: confirmation });
                }}
              >
                <div className="delete-warning">
                  <Trash2 size={20} />
                  <h3>This will delete the chat’s history.</h3>
                  <p>
                    Recorded questions and load failures will be permanently deleted. Other topic
                    rows and Telegram messages are kept. Future bot activity can recreate this row.
                  </p>
                </div>
                <div className="form-field">
                  <Label htmlFor={`confirm-${chat.id}`}>Type {chat.chat_id} to confirm</Label>
                  <Input
                    id={`confirm-${chat.id}`}
                    aria-label="Confirm Telegram ID"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    autoComplete="off"
                    disabled={busy}
                  />
                </div>
                <div className="delete-actions">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setDeleting(false);
                      setConfirmation("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={busy || confirmation !== String(chat.chat_id)}
                  >
                    Delete chat and history
                  </Button>
                </div>
              </form>
            )}
            {error && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
            {(busy || message) && (
              <p role="status" className="save-status">
                {busy ? "Saving changes…" : message}
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
function Overview({ navigate }: { navigate: (values: Record<string, string | null>) => void }) {
  const query = useQuery({
    queryKey: ["overview"],
    queryFn: ({ signal }) => api<OverviewPage>({ resource: "overview" }, signal),
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Overview</h1>
          <p>Your bot’s workspace, at a glance.</p>
        </div>
        <div className="heading-actions">
          <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RefreshCw size={15} />
            Refresh
          </Button>
          <Button onClick={() => navigate({ view: "chats" })}>
            View chats
            <ArrowRight size={15} />
          </Button>
        </div>
      </div>
      {query.isPending ? (
        <Loading label="Loading your workspace…" />
      ) : query.isError ? (
        <ErrorNotice error={query.error} retry={() => query.refetch()} />
      ) : (
        <>
          <div className="overview-stats">
            {[
              {
                label: "Registered chats",
                value: query.data.counts.chats,
                description: "Chats and forum topics",
                icon: MessageSquare,
              },
              {
                label: "Daily questions",
                value: query.data.counts.scheduled,
                description: "Active chats with cron enabled",
                icon: CalendarClock,
              },
              {
                label: "Questions delivered",
                value: query.data.counts.questions,
                description: "Recorded sends across all chats",
                icon: BookOpen,
              },
              {
                label: "Answers counted",
                value: query.data.counts.answered,
                description: "Marked as answered",
                icon: CircleCheck,
              },
            ].map((stat) => (
              <Card key={stat.label} className="stat-card block gap-0 p-5">
                <div className="stat-label">
                  <span>{stat.label}</span>
                  <stat.icon size={16} />
                </div>
                <strong>{stat.value.toLocaleString()}</strong>
                <p>{stat.description}</p>
              </Card>
            ))}
          </div>
          <div className="overview-panels">
            <Card className="activity-panel block gap-0 p-0">
              <div className="panel-heading">
                <div>
                  <h2>Recent activity</h2>
                  <p>The latest questions delivered to your chats.</p>
                </div>
                <UiBadge variant="outline">Latest {query.data.recentQuestions.length}</UiBadge>
              </div>
              {query.data.recentQuestions.length ? (
                <div className="activity-list">
                  {query.data.recentQuestions.map((question) => (
                    <button
                      key={question.id}
                      className="activity-item"
                      onClick={() => navigate({ view: "chats", chat: question.chatRowId })}
                    >
                      <span className="activity-icon">
                        <BookOpen size={17} />
                      </span>
                      <span className="activity-copy">
                        <strong>Question #{question.question_id || "unknown"}</strong>
                        <span>{question.chatTitle}</span>
                      </span>
                      <span className="activity-time">
                        <time>{date(question.created_at, question.chatTimezone)}</time>
                        <span>
                          {question.question_answered
                            ? "Answer counted"
                            : question.complexity || "Unspecified"}
                        </span>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty">
                  <BookOpen size={28} />
                  <h3>No questions delivered yet</h3>
                  <p>Recorded question sends will appear here.</p>
                </div>
              )}
            </Card>
            <Card className="schedules-panel block gap-0 p-0">
              <div className="panel-heading">
                <div>
                  <h2>Daily questions</h2>
                  <p>Active schedules in your workspace.</p>
                </div>
                <CalendarClock size={18} />
              </div>
              <div className="schedule-list">
                {query.data.scheduledChats.length ? (
                  query.data.scheduledChats.map((chat) => (
                    <button
                      key={chat.id}
                      className="scheduled-item"
                      onClick={() => navigate({ view: "chats", chat: chat.id })}
                    >
                      <span className="chat-avatar">
                        <MessageSquare size={16} />
                      </span>
                      <span>
                        <strong>{chat.title || "Unnamed chat"}</strong>
                        <span>{chat.timezone}</span>
                      </span>
                      <span className="schedule-time">{chat.cron_time.slice(0, 5)}</span>
                    </button>
                  ))
                ) : (
                  <p className="panel-empty">No active daily-question schedules.</p>
                )}
              </div>
              <div className="panel-footer">
                <Button
                  variant="ghost"
                  onClick={() =>
                    navigate({
                      view: "chats",
                      cron: "true",
                      active: null,
                      page: null,
                      search: null,
                    })
                  }
                >
                  View all schedules
                  <ArrowRight size={14} />
                </Button>
              </div>
            </Card>
          </div>
          <p className="overview-caption">
            Lifetime totals exclude integration-test question sends. Updated{" "}
            {new Date(query.dataUpdatedAt).toLocaleTimeString()}.
          </p>
        </>
      )}
    </>
  );
}
function ChatList({ params, navigate }: ReturnType<typeof useLocation>) {
  const [search, setSearch] = useState(params.get("search") ?? "");
  useEffect(() => setSearch(params.get("search") ?? ""), [params.get("search")]);
  const active = ["true", "false"].includes(params.get("active") ?? "")
    ? params.get("active")!
    : "all";
  const cron = ["true", "false"].includes(params.get("cron") ?? "") ? params.get("cron")! : "all";
  const sort = ["title", "cron_last_sent_at"].includes(params.get("sort") ?? "")
    ? params.get("sort")!
    : "created_at";
  const page = Math.min(10000, Math.max(0, Number(params.get("page")) || 0));
  const filters = {
    resource: "chats",
    search: params.get("search") ?? "",
    active,
    cron,
    sort,
    page: String(Math.floor(page)),
  };
  const query = useQuery({
    queryKey: ["chats", "activity-v1", filters],
    queryFn: ({ signal }) => api<ChatPage>(filters, signal),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            {cron === "true" ? "Daily questions" : active === "false" ? "Inactive chats" : "Chats"}
          </h1>
          <p>Manage your registered chats, topics, and bot settings.</p>
        </div>
        <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
          <RefreshCw size={16} aria-hidden="true" />
          Refresh
        </Button>
      </div>
      <nav className="view-tabs" aria-label="Chat views">
        <button
          aria-current={cron !== "true" && active !== "false" ? "page" : undefined}
          onClick={() => navigate({ view: "chats", cron: null, active: null, page: null })}
        >
          All chats
        </button>
        <button
          aria-current={cron === "true" ? "page" : undefined}
          onClick={() => navigate({ view: "chats", cron: "true", active: null, page: null })}
        >
          Daily questions
        </button>
        <button
          aria-current={active === "false" && cron !== "true" ? "page" : undefined}
          onClick={() => navigate({ view: "chats", active: "false", cron: null, page: null })}
        >
          Inactive
        </button>
      </nav>
      <div className="toolbar">
        <form
          className="search"
          onSubmit={(event) => {
            event.preventDefault();
            navigate({ search, page: null });
          }}
        >
          <Search size={17} aria-hidden="true" />
          <Label className="sr-only" htmlFor="chat-search">
            Search chats by title or Telegram ID
          </Label>
          <Input
            id="chat-search"
            className="pl-9"
            placeholder="Search title or Telegram ID"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            maxLength={100}
          />
          <Button variant="outline" type="submit">
            Search
          </Button>
        </form>
        <Label className="filter">
          Status
          <select value={active} onChange={(e) => navigate({ active: e.target.value, page: null })}>
            <option value="all">All chats</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </Label>
        <Label className="filter">
          Daily question
          <select value={cron} onChange={(e) => navigate({ cron: e.target.value, page: null })}>
            <option value="all">All schedules</option>
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </Label>
        <Label className="filter">
          Sort by
          <select value={sort} onChange={(e) => navigate({ sort: e.target.value, page: null })}>
            <option value="created_at">Newest registration</option>
            <option value="title">Chat title</option>
            <option value="cron_last_sent_at">Last scheduled send</option>
          </select>
        </Label>
      </div>
      {query.isError ? (
        <ErrorNotice error={query.error} retry={() => query.refetch()} />
      ) : query.isPending ? (
        <Loading label="Loading conversations…" />
      ) : (
        <>
          <div className="section-meta">
            <span>
              {query.data.total} registered chat{query.data.total === 1 ? "" : "s"} and topics
            </span>
            <span role="status">
              {query.isFetching
                ? "Updating…"
                : `Updated ${new Date(query.dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
            </span>
          </div>
          {query.data.items.length ? (
            <Table className="chat-table">
              <TableCaption className="sr-only">
                Registered chats and scheduled question status
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Chat / topic</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col">Activity</TableHead>
                  <TableHead scope="col">Daily question</TableHead>
                  <TableHead scope="col">Last scheduled send</TableHead>
                  <TableHead scope="col">Registered</TableHead>
                  <TableHead scope="col">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.items.map((chat) => (
                  <TableRow key={chat.id}>
                    <TableCell data-label="Chat">
                      <a
                        className="chat-link"
                        href={`/?${new URLSearchParams({ ...filters, resource: "", chat: chat.id })}`}
                        onClick={(e) => {
                          if (!e.ctrlKey && !e.metaKey && e.button === 0) {
                            e.preventDefault();
                            navigate({ chat: chat.id });
                          }
                        }}
                      >
                        <span className="chat-avatar">
                          <MessageSquare size={16} aria-hidden="true" />
                        </span>
                        <span className="chat-identity">
                          <span>{chat.title || "Unnamed chat"}</span>
                          <span className="sub mono chat-identifier">
                            {chat.chat_id}
                            {chat.thread_id !== null
                              ? ` · Chat topic ${chat.thread_id}`
                              : " · Main chat"}
                          </span>
                        </span>
                      </a>
                    </TableCell>
                    <TableCell data-label="Status">
                      <StatusBadge enabled={chat.is_active} yes="Active" no="Inactive" />
                    </TableCell>
                    <TableCell data-label="Activity">
                      <div className="chat-activity">
                        <span>
                          <BookOpen size={13} aria-hidden="true" />
                          <strong>{chat.counts?.loaded?.toLocaleString() ?? "—"}</strong>
                          <span>Questions</span>
                        </span>
                        <span>
                          <CircleCheck size={13} aria-hidden="true" />
                          <strong>{chat.counts?.answered?.toLocaleString() ?? "—"}</strong>
                          <span>Answers counted</span>
                        </span>
                        <span>
                          <Lightbulb size={13} aria-hidden="true" />
                          <strong>{chat.counts?.hints?.toLocaleString() ?? "—"}</strong>
                          <span>Hint requests</span>
                        </span>
                      </div>
                    </TableCell>
                    <TableCell data-label="Daily question">
                      <div className="schedule">
                        <Clock3 size={15} aria-hidden="true" />
                        {chat.cron_enabled ? chat.cron_time.slice(0, 5) : "Off"}
                      </div>
                      <div className="sub">{chat.timezone}</div>
                    </TableCell>
                    <TableCell data-label="Last send">
                      <time>{date(chat.cron_last_sent_at, chat.timezone)}</time>
                      <div className="sub">
                        {chat.cron_last_sent_at ? "Chat local time" : "No recorded send"}
                      </div>
                    </TableCell>
                    <TableCell data-label="Registered">
                      <time>{date(chat.created_at)}</time>
                      <div className="sub">Your local time</div>
                    </TableCell>
                    <TableCell data-label="Actions">
                      <ChatActions
                        chat={chat}
                        disabled={query.isFetching}
                        openChat={() => navigate({ view: "chats", chat: chat.id })}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="empty">
              <MessageSquare size={30} aria-hidden="true" />
              <h2>No chats found</h2>
              <p>
                Try another search or clear the filters. Chats appear after the bot registers them.
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setSearch("");
                  navigate({ search: null, active: null, cron: null, page: null });
                }}
              >
                Clear filters
              </Button>
            </div>
          )}
          <div className="pagination">
            <span>
              Page {Math.floor(page) + 1} of{" "}
              {Math.max(1, Math.ceil(query.data.total / query.data.pageSize))}
            </span>
            <div>
              <Button
                variant="outline"
                disabled={page === 0 || query.isFetching}
                onClick={() => navigate({ page: String(page - 1) })}
              >
                <ArrowLeft size={15} aria-hidden="true" />
                Previous
              </Button>
              <Button
                variant="outline"
                disabled={(page + 1) * query.data.pageSize >= query.data.total || query.isFetching}
                onClick={() => navigate({ page: String(page + 1) })}
              >
                Next
                <ArrowRight size={15} aria-hidden="true" />
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
function AnswerPreview({ chatId, sendId }: { chatId: string; sendId: number }) {
  const query = useQuery({
    queryKey: ["question", chatId, sendId],
    queryFn: ({ signal }) =>
      api<QuestionDetail>({ resource: "question", chatId, sendId: String(sendId) }, signal),
  });
  if (query.isPending) return <Loading label="Loading answer…" />;
  if (query.isError) return <ErrorNotice error={query.error} retry={() => query.refetch()} />;
  return (
    <div className="question-copy">
      <h3>Answer</h3>
      <TelegramMarkdown text={query.data.answer ?? "Answer text is unavailable for this send."} />
      {query.data.description &&
        !hasEmbeddedDescription(query.data.answer, query.data.description) && (
          <>
            <h3>Comment</h3>
            <TelegramMarkdown text={query.data.description} />
          </>
        )}
    </div>
  );
}
function QuestionRow({
  question,
  chatId,
  timezone,
}: {
  question: DashboardQuestion;
  chatId: string;
  timezone: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="question-row block gap-0 rounded-md p-4 sm:p-5">
      <div className="question-heading">
        <div>
          <span className="mono sub">{date(question.created_at, timezone)}</span>
          <h3>
            {question.question_id ? `Question #${question.question_id}` : "Question ID unavailable"}
          </h3>
        </div>
        <UiBadge variant="secondary">{question.complexity ?? "Unspecified"}</UiBadge>
      </div>
      <p className="question-body">
        {question.question ?? "Question text is unavailable for this send."}
      </p>
      <div className="question-status">
        <span>
          Answer:{" "}
          {question.question_answered === null
            ? "Not recorded"
            : question.question_answered
              ? "Counted"
              : "Not counted"}
        </span>
        <span>
          Hint:{" "}
          {question.hint_failed ? "Failed" : question.hint_asked ? "Requested" : "Not requested"}
        </span>
        <span className="mono sub">Message {question.telegram_message_id}</span>
      </div>
      <div className="question-actions">
        <Button variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Hide answer" : "Show answer"}
          <ChevronDown size={15} aria-hidden="true" />
        </Button>
        {question.question_id && /^\d+$/.test(question.question_id) && (
          <a
            href={`https://gotquestions.online/question/${question.question_id}`}
            target="_blank"
            rel="noreferrer"
          >
            Open source
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
      </div>
      {open && <AnswerPreview chatId={chatId} sendId={question.id} />}
    </Card>
  );
}
function Setting({
  label,
  value,
  effective,
}: {
  label: string;
  value: boolean;
  effective?: boolean;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <StatusBadge enabled={value} />
        {effective !== undefined && effective !== value && (
          <span className="sub">Effectively disabled by group settings</span>
        )}
      </dd>
    </div>
  );
}
function ChatView({ chatId, back }: { chatId: string; back: () => void }) {
  const query = useQuery({
    queryKey: ["chat", chatId],
    queryFn: ({ signal }) => api<ChatDetail>({ resource: "chat", chatId }, signal),
  });
  const history = useInfiniteQuery({
    queryKey: ["questions", "question-text-v1", chatId],
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) =>
      api<QuestionPage>(
        { resource: "questions", chatId, ...(pageParam ? { cursor: pageParam } : {}) },
        signal,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const chat: DashboardChat | undefined = query.data?.chat;
  return (
    <>
      <Button variant="ghost" className="back" onClick={back}>
        <ArrowLeft size={16} aria-hidden="true" />
        All conversations
      </Button>
      {query.isPending ? (
        <Loading label="Loading chat details…" />
      ) : query.isError ? (
        <ErrorNotice error={query.error} retry={() => query.refetch()} />
      ) : (
        chat && (
          <>
            <div className="page-heading chat-detail-heading">
              <div>
                <h1>{chat.title || "Unnamed chat"}</h1>
                <p className="mono">
                  {chat.chat_id}
                  {chat.thread_id !== null ? ` / Chat topic ${chat.thread_id}` : " / Main chat"}
                </p>
              </div>
              <div className="heading-actions">
                <StatusBadge enabled={chat.is_active} yes="Active chat" no="Inactive chat" />
                <ChatActions chat={chat} disabled={query.isFetching} />
              </div>
            </div>
            <div className="detail-stat-strip">
              <div>
                <BookOpen size={17} />
                <span>
                  <strong>{query.data!.counts.loaded}</strong>Questions delivered
                </span>
              </div>
              <div>
                <CircleCheck size={17} />
                <span>
                  <strong>{query.data!.counts.answered}</strong>Answers counted
                </span>
              </div>
              <div>
                <ShieldCheck size={17} />
                <span>
                  <strong>{query.data!.counts.hints}</strong>Hints requested
                </span>
              </div>
            </div>
            <div className="details-layout">
              <section className="chat-facts" aria-labelledby="settings-title">
                <h2 id="settings-title">Chat information</h2>
                <dl>
                  <div>
                    <dt>Registered</dt>
                    <dd>{date(chat.created_at, chat.timezone)}</dd>
                  </div>
                  <div>
                    <dt>Last database update</dt>
                    <dd>{date(chat.updated_at, chat.timezone)}</dd>
                  </div>
                  <div>
                    <dt>Timezone</dt>
                    <dd>{chat.timezone}</dd>
                  </div>
                  <Setting label="Daily question" value={chat.cron_enabled} />
                  <div>
                    <dt>Configured schedule</dt>
                    <dd>Daily at {chat.cron_time.slice(0, 5)}</dd>
                  </div>
                  <div>
                    <dt>Last successful scheduled send</dt>
                    <dd>{date(chat.cron_last_sent_at, chat.timezone)}</dd>
                  </div>
                  <Setting
                    label="Commands"
                    value={chat.commands_enabled}
                    effective={query.data!.effectiveSettings.commands_enabled}
                  />
                  <Setting
                    label="Answer buttons"
                    value={chat.answer_buttons_enabled}
                    effective={query.data!.effectiveSettings.answer_buttons_enabled}
                  />
                </dl>
                <p className="schedule-note">
                  <Clock3 size={16} aria-hidden="true" />
                  Ticker runs at 09:00 and 10:00 UTC and matches the configured local hour. Other
                  schedules may not be covered. Execution attempts and failures are not recorded
                  here.
                </p>
                <p className="sub">
                  Dates in {chat.timezone}. Registration means the database row was created, not
                  when the bot joined Telegram.
                </p>
              </section>
              <section className="history" aria-labelledby="history-title">
                <div className="history-title">
                  <div>
                    <h2 id="history-title">Question history</h2>
                    <p>
                      {query.data!.counts.loaded} loaded · {query.data!.counts.answered} answers
                      counted · {query.data!.counts.hints} hints requested
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => {
                      query.refetch();
                      history.refetch();
                    }}
                    disabled={query.isFetching || history.isFetching}
                  >
                    <RefreshCw size={15} aria-hidden="true" />
                    Refresh
                  </Button>
                </div>
                <p className="sub history-note">
                  This chat/topic only. Repeated questions appear as separate sends. Test sends are
                  excluded.
                </p>
                {history.isPending ? (
                  <Loading label="Loading question history…" />
                ) : (
                  <>
                    {history.isError && (
                      <ErrorNotice error={history.error} retry={() => history.refetch()} />
                    )}
                    {history.data?.pages
                      .flatMap((page) => page.items)
                      .map((question) => (
                        <QuestionRow
                          key={question.id}
                          question={question}
                          chatId={chatId}
                          timezone={chat.timezone}
                        />
                      ))}
                    {history.data && !history.data.pages[0].items.length && (
                      <div className="empty">
                        <h3>No questions recorded</h3>
                        <p>Questions successfully sent to this chat/topic will appear here.</p>
                      </div>
                    )}
                    {history.hasNextPage && (
                      <Button
                        variant="outline"
                        className="load-more"
                        disabled={history.isFetchingNextPage}
                        onClick={() => history.fetchNextPage()}
                      >
                        {history.isFetchingNextPage ? "Loading…" : "Load older questions"}
                        <ChevronDown size={16} aria-hidden="true" />
                      </Button>
                    )}
                  </>
                )}
              </section>
            </div>
          </>
        )
      )}
    </>
  );
}
function Dashboard({ email }: { email: string }) {
  const location = useLocation();
  const [signOutError, setSignOutError] = useState("");
  const [busy, setBusy] = useState(false);
  const chatId = location.params.get("chat");
  const view =
    location.params.get("view") === "send-question"
      ? "send-question"
      : chatId ||
          location.params.get("view") === "chats" ||
          location.params.has("search") ||
          location.params.has("cron") ||
          location.params.has("active")
        ? "chats"
        : "overview";
  async function signOut() {
    setBusy(true);
    setSignOutError("");
    try {
      const { error } = await supabase!.auth.signOut();
      if (error) throw error;
    } catch {
      setSignOutError("Unable to sign out. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  const title = chatId
    ? "Chat details"
    : view === "send-question"
      ? "Send question"
      : view === "overview"
        ? "Overview"
        : location.params.get("cron") === "true"
          ? "Daily questions"
          : location.params.get("active") === "false"
            ? "Inactive chats"
            : "Chats";
  return (
    <AdminShell
      email={email}
      title={title}
      view={view}
      cronOnly={location.params.get("cron") === "true"}
      inactiveOnly={location.params.get("active") === "false"}
      navigate={location.navigate}
      signingOut={busy}
      signOut={signOut}
    >
      {signOutError && <ErrorNotice error={new Error(signOutError)} />}
      {view === "send-question" ? (
        <SendQuestionPage />
      ) : chatId ? (
        <ChatView
          key={chatId}
          chatId={chatId}
          back={() => location.navigate({ chat: null, view: "chats" })}
        />
      ) : view === "overview" ? (
        <Overview navigate={location.navigate} />
      ) : (
        <ChatList {...location} />
      )}
    </AdminShell>
  );
}
function SignedIn({ email }: { email: string }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30000,
            retry: (attempt, error) =>
              !(error instanceof ApiError && [400, 401, 403, 404].includes(error.status)) &&
              attempt < 1,
          },
        },
      }),
  );
  useEffect(
    () => () => {
      client.clear();
    },
    [client],
  );
  return (
    <QueryClientProvider client={client}>
      <Dashboard email={email} />
    </QueryClientProvider>
  );
}
function App() {
  const { session, loading, error } = useSession();
  if (!supabase)
    return (
      <main className="auth">
        <h1>Dashboard setup needed</h1>
        <p>
          Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart the local server or
          rebuild the deployment.
        </p>
      </main>
    );
  if (loading)
    return (
      <main className="auth">
        <Loading label="Restoring your session…" />
      </main>
    );
  return session ? (
    <SignedIn key={session.user.id} email={session.user.email ?? "Signed-in user"} />
  ) : (
    <Login initialError={error} />
  );
}
try {
  document.documentElement.classList.toggle(
    "dark",
    localStorage.getItem("dashboard-theme") === "dark",
  );
} catch {
  /* Default to light if storage is unavailable. */
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </StrictMode>,
);
