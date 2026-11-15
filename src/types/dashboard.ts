/** Browser-safe contracts. Never import server services into the web bundle. */
export interface DashboardChat {
  id: string;
  chat_id: number;
  thread_id: number | null;
  title: string | null;
  timezone: string;
  is_active: boolean;
  cron_enabled: boolean;
  cron_time: string;
  cron_last_sent_at: string | null;
  commands_enabled: boolean;
  answer_buttons_enabled: boolean;
  hint_enabled: boolean;
  created_at: string;
  updated_at: string;
}
export interface ChatCounts {
  loaded: number;
  answered: number;
  hints: number;
}
export interface ChatListItem extends DashboardChat {
  counts: ChatCounts;
}
export interface ChatPage {
  items: ChatListItem[];
  total: number;
  page: number;
  pageSize: number;
}
export interface ChatDetail {
  chat: DashboardChat;
  effectiveSettings: {
    commands_enabled: boolean;
    answer_buttons_enabled: boolean;
    hint_enabled: boolean;
  };
  counts: ChatCounts;
}
export interface DashboardQuestion {
  id: number;
  /** Included in paginated chat history; older records may not have saved text. */
  question?: string | null;
  question_id: string | null;
  telegram_message_id: number;
  complexity: string | null;
  hint_asked: boolean;
  hint_failed: boolean;
  hint_at: string | null;
  question_answered: boolean | null;
  created_at: string;
}
export interface QuestionPage {
  items: DashboardQuestion[];
  nextCursor: string | null;
}
export interface QuestionDetail {
  question: string | null;
  answer: string | null;
  description: string | null;
}

export interface OverviewPage {
  counts: { chats: number; scheduled: number; questions: number; answered: number };
  scheduledChats: DashboardChat[];
  recentQuestions: Array<
    DashboardQuestion & { chatRowId: string; chatTitle: string; chatTimezone: string }
  >;
}

export interface QuestionDraft {
  id: string;
  complexity: "random" | "easy" | "medium" | "hard";
  question: string;
  answer: string;
  attachments: number;
  sourceUrl: string;
}
export interface QuestionDelivery {
  chatRowId: string;
  status: "sent" | "failed" | "pending" | "unknown";
  messageId?: number;
  error?: string;
}
export interface QuestionDeliveryResult {
  questionId: string;
  results: QuestionDelivery[];
}
