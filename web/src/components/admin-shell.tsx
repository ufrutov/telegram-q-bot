import { useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import {
  Archive,
  CalendarClock,
  ChevronRight,
  CircleHelp,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  MessagesSquare,
  Moon,
  Search,
  Send,
  Sun,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "./ui/sidebar";

interface ShellProps {
  email: string;
  title: string;
  view: string;
  cronOnly: boolean;
  inactiveOnly: boolean;
  navigate: (values: Record<string, string | null>) => void;
  signOut: () => void;
  signingOut: boolean;
  children: ReactNode;
}
export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("dashboard-theme", next ? "dark" : "light");
    } catch {
      /* Theme still works when storage is unavailable. */
    }
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={dark ? "Use light theme" : "Use dark theme"}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
function SidebarNavigation(props: ShellProps) {
  const { setOpenMobile } = useSidebar();
  function go(values: Record<string, string | null>) {
    props.navigate({ chat: null, page: null, search: null, active: null, cron: null, ...values });
    setOpenMobile(false);
  }
  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="p-4 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
        <SidebarMenu className="group-data-[collapsible=icon]:w-8">
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="group-data-[collapsible=icon]:mt-2"
              onClick={() => go({ view: "overview" })}
              tooltip="Question Bot"
            >
              <span className="workspace-logo group-data-[collapsible=icon]:size-8">
                <MessageSquare size={20} />
              </span>
              <div className="workspace-title">
                <strong>Question Bot</strong>
                <span>Administration</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="p-4 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarMenu className="group-data-[collapsible=icon]:w-8">
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={props.view === "overview"}
                tooltip="Overview"
                onClick={() => go({ view: "overview" })}
              >
                <LayoutDashboard />
                <span>Overview</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={props.view === "chats" && !props.cronOnly && !props.inactiveOnly}
                tooltip="Chats"
                onClick={() => go({ view: "chats" })}
              >
                <MessagesSquare />
                <span>Chats</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={props.view === "send-question"}
                tooltip="Send question"
                onClick={() => go({ view: "send-question" })}
              >
                <Send />
                <span>Send question</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup className="p-4 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
          <SidebarGroupLabel>Saved views</SidebarGroupLabel>
          <SidebarMenu className="group-data-[collapsible=icon]:w-8">
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={props.view === "chats" && props.cronOnly}
                tooltip="Daily questions"
                onClick={() => go({ view: "chats", cron: "true" })}
              >
                <CalendarClock />
                <span>Daily questions</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={props.view === "chats" && props.inactiveOnly}
                tooltip="Inactive chats"
                onClick={() => go({ view: "chats", active: "false" })}
              >
                <Archive />
                <span>Inactive chats</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
        <div className="sidebar-note">
          <CircleHelp size={16} />
          <p>
            Manage your bot’s chats.
            <br />
            <span>Changes are saved to Supabase.</span>
          </p>
        </div>
        <SidebarMenu className="group-data-[collapsible=icon]:w-8">
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip={props.email}
              onClick={props.signOut}
              disabled={props.signingOut}
            >
              <span className="user-avatar">{props.email.charAt(0).toUpperCase()}</span>
              <div className="workspace-title">
                <strong>My account</strong>
                <span>{props.email}</span>
              </div>
              <LogOut className="ml-auto" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
export function AdminShell(props: ShellProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  function submit(event: FormEvent) {
    event.preventDefault();
    props.navigate({ view: "chats", chat: null, page: null, search, cron: null, active: null });
  }
  return (
    <SidebarProvider
      className="admin-shell"
      style={{ "--sidebar-width-icon": "4rem" } as CSSProperties}
    >
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SidebarNavigation {...props} />
      <SidebarInset className="admin-inset">
        <header className="admin-topbar p-4">
          <div className="topbar-location">
            <SidebarTrigger />
            <span className="topbar-divider" />
            <span className="topbar-workspace">
              Workspace
              <ChevronRight size={14} />
            </span>
            <span>{props.title}</span>
          </div>
          <div className="topbar-tools">
            <form onSubmit={submit} className="global-search">
              <Search size={15} aria-hidden="true" />
              <Input
                ref={searchRef}
                className="pl-8 pr-12 max-sm:pr-2"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search chats…"
                aria-label="Search all chats"
              />
              <kbd>⌘ K</kbd>
            </form>
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="avatar-button" aria-label="Account menu">
                  <span className="user-avatar">{props.email.charAt(0).toUpperCase()}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{props.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={props.signOut} disabled={props.signingOut}>
                  <LogOut />
                  {props.signingOut ? "Signing out…" : "Sign out"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main id="main" className="admin-main p-4">
          {props.children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
