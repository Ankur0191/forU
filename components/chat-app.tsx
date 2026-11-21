"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import type { RealtimeChannel, User } from "@supabase/supabase-js";
import {
  ArrowDown, ArrowLeft, Check, CheckCheck, Heart, LogOut, MessageCircle,
  MoreHorizontal, Paperclip, Send, Smile, Sparkles, Wifi, WifiOff,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { emailForUsername, peerUsernameForEmail, usernameForEmail } from "@/lib/accounts";

type Message = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

type ConnectionState = "connecting" | "connected" | "disconnected";

function initials(value: string) {
  return value.trim().slice(0, 1).toUpperCase() || "?";
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function dayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat([], { weekday: "long", month: "long", day: "numeric" }).format(date);
}

export function ChatApp() {
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  const supabase = useMemo(() => configured ? createClient() : null, [configured]);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [membershipIssue, setMembershipIssue] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [online, setOnline] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(true);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const currentUsername = usernameForEmail(user?.email);
  const peerUsername = peerUsernameForEmail(user?.email);
  const currentUserId = user?.id;

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setUser(data.user);
      setAuthLoading(false);
    }).catch(() => {
      if (active) setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) setMobileChatOpen(true);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  const loadMessages = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("messages")
      .select("id,sender_id,body,created_at,read_at")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) {
      setSendError("Couldn't load messages. Check your connection and database setup.");
      return;
    }
    if (data) setMessages((data as Message[]).reverse());
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !currentUserId) {
      setMembershipIssue("");
      setConnection("disconnected");
      return;
    }

    let active = true;
    let realtime: RealtimeChannel | null = null;

    async function connect() {
      setConnection("connecting");
      setMembershipIssue("");
      const { data: membership, error: membershipError } = await supabase!
        .from("foru_members")
        .select("user_id")
        .eq("user_id", currentUserId)
        .maybeSingle();

      if (!active) return;
      if (membershipError || !membership) {
        setMembershipIssue("This account hasn't been invited into this private conversation yet. Ask the owner to add its Auth user ID to foru_members.");
        setConnection("disconnected");
        return;
      }

      await loadMessages();
      if (!active) return;

      const { data: sessionData } = await supabase!.auth.getSession();
      if (sessionData.session?.access_token) {
        await supabase!.realtime.setAuth(sessionData.session.access_token);
      }

      realtime = supabase!.channel("foru:private-chat", {
        config: {
          private: true,
          presence: { key: currentUserId },
          broadcast: { self: false, ack: true },
        },
      });

      realtime
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
          const incoming = payload.new as Message;
          setMessages((previous) =>
            previous.some((message) => message.id === incoming.id)
              ? previous
              : [...previous, incoming],
          );
          if (incoming.sender_id !== currentUserId && !incoming.read_at) {
            supabase!.from("messages")
              .update({ read_at: new Date().toISOString() })
              .eq("id", incoming.id)
              .is("read_at", null)
              .then(() => undefined);
          }
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => {
          const updated = payload.new as Message;
          setMessages((previous) => previous.map((message) =>
            message.id === updated.id ? { ...message, read_at: updated.read_at } : message,
          ));
        })
        .on("broadcast", { event: "typing" }, ({ payload }) => {
          setPeerTyping(Boolean((payload as { active?: boolean }).active));
        })
        .on("presence", { event: "sync" }, () => {
          const state = realtime?.presenceState() ?? {};
          setOnline(Object.keys(state).some((key) => key !== currentUserId));
        })
        .subscribe(async (status) => {
          if (!active) return;
          if (status === "SUBSCRIBED") {
            setConnection("connected");
            await realtime?.track({
              user_id: currentUserId,
              online_at: new Date().toISOString(),
            });
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setConnection("disconnected");
            setOnline(false);
          }
        });

      channelRef.current = realtime;
    }

    void connect();
    return () => {
      active = false;
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      if (realtime) void supabase.removeChannel(realtime);
      channelRef.current = null;
      setPeerTyping(false);
      setOnline(false);
    };
  }, [currentUserId, loadMessages, supabase]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, peerTyping]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");
    if (!supabase) {
      setLoginError("The app needs its Supabase environment settings before you can sign in.");
      return;
    }
    const email = emailForUsername(username);
    if (!email) {
      setLoginError("That username isn't one of the two invited accounts.");
      return;
    }
    setLoggingIn(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setLoginError("We couldn't sign you in. Check your username and password.");
    setLoggingIn(false);
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!supabase || !body || !currentUserId || sending || connection !== "connected") return;
    if (body.length > 10000) {
      setSendError("Messages can be up to 10,000 characters.");
      return;
    }

    setSending(true);
    setSendError("");
    setDraft("");
    const optimistic: Message = {
      id: crypto.randomUUID(),
      sender_id: currentUserId,
      body,
      created_at: new Date().toISOString(),
      read_at: null,
    };
    setMessages((previous) => [...previous, optimistic]);

    const { data, error } = await supabase
      .from("messages")
      .insert({ id: optimistic.id, sender_id: currentUserId, body })
      .select("id,sender_id,body,created_at,read_at")
      .single();

    if (error) {
      setMessages((previous) => previous.filter((message) => message.id !== optimistic.id));
      setDraft(body);
      setSendError("Message not sent. Please try again.");
    } else if (data) {
      setMessages((previous) => previous.map((message) =>
        message.id === optimistic.id ? data as Message : message,
      ));
    }

    setSending(false);
    await channelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { active: false },
    });
  }

  function updateDraft(value: string) {
    setDraft(value);
    setSendError("");
    const channel = channelRef.current;
    if (!channel) return;
    void channel.send({ type: "broadcast", event: "typing", payload: { active: true } });
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      void channel.send({ type: "broadcast", event: "typing", payload: { active: false } });
    }, 1400);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  async function logout() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setMessages([]);
    setDraft("");
    setMobileChatOpen(false);
  }

  if (authLoading) {
    return <main className="loading-screen"><div className="loading-brand"><MessageCircle size={22}/> forU<span>.</span></div><div className="loading-orbit"/></main>;
  }

  if (!user) {
    return (
      <main className="login-screen">
        <div className="login-glow glow-one" />
        <div className="login-glow glow-two" />
        <section className="login-card">
          <div className="brand-mark"><MessageCircle size={23} /><span>forU</span><span className="brand-dot">.</span></div>
          <div className="login-intro">
            <div className="eyebrow"><span className="pulse-dot" /> A LITTLE SPACE, JUST FOR TWO</div>
            <h1>Some things are<br /><span>better shared.</span></h1>
            <p>Your own quiet corner of the internet. Just you, your person, and the conversations in between.</p>
          </div>
          <form onSubmit={handleLogin} className="login-form">
            <label htmlFor="username">Your username</label>
            <input id="username" autoComplete="username" placeholder="Enter your username" value={username} onChange={(event) => setUsername(event.target.value)} required />
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            {loginError && <p className="form-error">{loginError}</p>}
            {!configured && <p className="form-error">Supabase isn't configured. Add the variables from .env.example to your deployment.</p>}
            <button className="primary-button login-button" disabled={loggingIn || !configured}>
              {loggingIn ? "Opening your space…" : <>Enter your space <span>↗</span></>}
            </button>
          </form>
          <div className="login-foot">
            <span><span className="lock-symbol">⌑</span> A private space for two</span>
            <span>Made with <Heart size={12} fill="currentColor" /></span>
          </div>
        </section>
        <div className="login-caption">A small world, shared between two people.</div>
      </main>
    );
  }

  const dayGroups = messages.reduce<{ day: string; items: Message[] }[]>((groups, message) => {
    const day = new Date(message.created_at).toDateString();
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(message);
    else groups.push({ day, items: [message] });
    return groups;
  }, []);

  return (
    <main className="app-shell">
      <aside className={"sidebar " + (mobileChatOpen ? "sidebar-hidden-mobile" : "")}>
        <div className="sidebar-top">
          <div className="brand-mark small"><MessageCircle size={21} /><span>forU</span><span className="brand-dot">.</span></div>
          <div className="sidebar-private"><span className="pulse-dot" /> PRIVATE</div>
        </div>
        <div className="sidebar-heading">
          <div><div className="section-kicker">YOUR SPACE</div><h2>Conversations</h2></div>
          <div className="count-pill">01</div>
        </div>
        <button className="conversation-item active" onClick={() => setMobileChatOpen(true)}>
          <div className="avatar-wrap">
            <div className="avatar avatar-peer">{initials(peerUsername)}</div>
            <span className={"presence-indicator " + (online ? "is-online" : "")} />
          </div>
          <div className="conversation-copy">
            <div className="conversation-name">{peerUsername}</div>
            <div className="conversation-preview">{peerTyping ? <span className="typing-preview">typing…</span> : messages.at(-1)?.body ?? "Your story starts here"}</div>
          </div>
          <div className="conversation-meta">
            <span>{messages.at(-1) ? timeLabel(messages.at(-1)!.created_at) : ""}</span>
            <span className="conversation-status">{online ? "Online" : "Private"}</span>
          </div>
        </button>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <div className="privacy-icon"><Sparkles size={16} /></div>
            <div><strong>A space of your own</strong><span>Only two people belong here.</span></div>
          </div>
          <div className="profile-row">
            <div className="avatar avatar-you">{initials(currentUsername)}</div>
            <div className="profile-copy"><strong>{currentUsername}</strong><span>Your account</span></div>
            <button className="icon-button logout-button" onClick={logout} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button>
          </div>
        </div>
      </aside>

      <section className={"chat-panel " + (mobileChatOpen ? "chat-open-mobile" : "")}>
        <header className="chat-header">
          <button className="icon-button back-button" onClick={() => setMobileChatOpen(false)} aria-label="Back to conversations"><ArrowLeft size={20} /></button>
          <div className="avatar-wrap">
            <div className="avatar avatar-peer header-avatar">{initials(peerUsername)}</div>
            <span className={"presence-indicator " + (online ? "is-online" : "")} />
          </div>
          <div className="header-person">
            <h2>{peerUsername}</h2>
            <span><i className={online ? "online-dot" : "offline-dot"} />{online ? "Here with you" : "Your private space"}</span>
          </div>
          <div className="header-actions">
            <div className="encrypted-label"><span className="tiny-lock">⌑</span> PRIVATE CHAT</div>
            <div className={"connection-indicator " + connection} title={"Realtime " + connection}>
              {connection === "connected" ? <Wifi size={15} /> : <WifiOff size={15} />}
            </div>
            <button className="icon-button" aria-label="Conversation details"><MoreHorizontal size={20} /></button>
          </div>
        </header>

        {membershipIssue ? (
          <div className="setup-state">
            <div className="setup-state-icon"><Sparkles size={20} /></div>
            <h2>Almost there.</h2>
            <p>{membershipIssue}</p>
            <button className="secondary-button" onClick={logout}>Sign out</button>
          </div>
        ) : (
          <>
            <div className="chat-content" ref={scrollRef} onScroll={() => {
              const element = scrollRef.current;
              if (element) setShowScrollDown(element.scrollHeight - element.scrollTop - element.clientHeight > 220);
            }}>
              <div className="conversation-intro">
                <div className="intro-sparkle"><Sparkles size={17} /></div>
                <div className="intro-title">Just between you two.</div>
                <p>No noise, no crowd. Just a little place for your words to find each other.</p>
                <div className="start-divider"><span /><span>THE BEGINNING OF SOMETHING</span><span /></div>
              </div>

              {dayGroups.map((group) => (
                <div key={group.day}>
                  <div className="date-divider"><span>{dayLabel(group.items[0].created_at)}</span></div>
                  {group.items.map((message, index) => {
                    const mine = message.sender_id === currentUserId;
                    const previous = group.items[index - 1];
                    const grouped = previous?.sender_id === message.sender_id
                      && new Date(message.created_at).getTime() - new Date(previous.created_at).getTime() < 120000;
                    return (
                      <div className={"message-row " + (mine ? "mine" : "theirs")} key={message.id}>
                        <div className={"message-bubble " + (mine ? "mine-bubble" : "their-bubble") + (grouped ? " grouped" : "")}>
                          <p>{message.body}</p>
                          <div className="message-meta">
                            <span>{timeLabel(message.created_at)}</span>
                            {mine && <span className={"read-state " + (message.read_at ? "read" : "")} title={message.read_at ? "Read" : "Sent"}>
                              {message.read_at ? <CheckCheck size={14} /> : <Check size={14} />}
                            </span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
              {peerTyping && <div className="typing-indicator" aria-label={peerUsername + " is typing"}><span /><span /><span /></div>}
              {connection === "disconnected" && <div className="connection-note">Reconnecting to your private space…</div>}
              <div ref={endRef} />
            </div>
            {showScrollDown && <button className="scroll-down" onClick={() => endRef.current?.scrollIntoView({ behavior: "smooth" })} aria-label="Scroll to latest"><ArrowDown size={17} /></button>}
            <footer className="composer-area">
              {sendError && <div className="send-error">{sendError}</div>}
              <form className="composer" onSubmit={sendMessage} ref={formRef}>
                <button type="button" className="composer-tool" aria-label="Attachments are not available yet" title="Attachments coming soon"><Paperclip size={19} /></button>
                <textarea value={draft} onChange={(event) => updateDraft(event.target.value)} onKeyDown={handleComposerKeyDown} placeholder="Write something nice…" rows={1} maxLength={10000} aria-label="Message" />
                <button type="button" className="composer-tool emoji-button" aria-label="Add a heart" onClick={() => updateDraft(draft + " ❤️")}><Smile size={19} /></button>
                <button type="submit" className="send-button" disabled={!draft.trim() || sending || connection !== "connected"} aria-label="Send message">
                  <Send size={18} />
                </button>
              </form>
              <div className="composer-hint">
                <span>ENTER TO SEND <kbd>↵</kbd></span>
                <span>MADE FOR TWO <Heart size={10} fill="currentColor" /></span>
              </div>
            </footer>
          </>
        )}
      </section>
    </main>
  );
}
