"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSessionStore } from "@/lib/session-store";
import { formatTime } from "@/lib/time";
import { useSessionController } from "@/lib/session-controller";

export function ChatPanel() {
  const chatMessages = useSessionStore((state) => state.chatMessages);
  const isChatStreaming = useSessionStore((state) => state.isChatStreaming);
  const sendChatMessage = useSessionController().sendChatMessage;
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) {
      return;
    }
    body.scrollTop = body.scrollHeight;
  }, [chatMessages]);

  const submit = async () => {
    const value = draft.trim();
    if (!value) {
      return;
    }
    setDraft("");
    await sendChatMessage(value);
  };

  const markdownComponents = {
    h1: ({ children }: { children?: React.ReactNode }) => (
      <p>
        <strong>{children}</strong>
      </p>
    ),
    h2: ({ children }: { children?: React.ReactNode }) => (
      <p>
        <strong>{children}</strong>
      </p>
    ),
    h3: ({ children }: { children?: React.ReactNode }) => (
      <p>
        <strong>{children}</strong>
      </p>
    ),
    h4: ({ children }: { children?: React.ReactNode }) => (
      <p>
        <strong>{children}</strong>
      </p>
    ),
    h5: ({ children }: { children?: React.ReactNode }) => (
      <p>
        <strong>{children}</strong>
      </p>
    ),
    h6: ({ children }: { children?: React.ReactNode }) => (
      <p>
        <strong>{children}</strong>
      </p>
    ),
  };

  return (
    <section className="panel">
      <header className="panel-header">
        <span>3. Chat</span>
        <span>session-only</span>
      </header>
      <div className="panel-body" ref={bodyRef}>
        <div className="banner">
          Clicking a suggestion adds it to this chat and streams a detailed answer.
          Users can also type questions directly.
        </div>
        {chatMessages.length === 0 ? (
          <div className="empty">
            Click a suggestion or type a question below.
          </div>
        ) : (
          chatMessages.map((message) => (
            <div className={`chat-message ${message.role}`} key={message.id}>
              <div className="chat-who">
                {message.role === "user" ? "You" : "Assistant"} ·{" "}
                {formatTime(message.createdAt)}
              </div>
              <div className="chat-bubble">
                {message.role === "assistant" ? (
                  <ReactMarkdown
                    components={markdownComponents}
                    remarkPlugins={[remarkGfm]}
                  >
                    {message.text || "…"}
                  </ReactMarkdown>
                ) : (
                  message.text || "…"
                )}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="chat-input-row">
        <input
          className="chat-input"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void submit();
            }
          }}
          placeholder="Ask anything…"
          value={draft}
        />
        <button
          className="primary-button"
          disabled={isChatStreaming}
          onClick={() => void submit()}
          type="button"
        >
          Send
        </button>
      </div>
    </section>
  );
}
