import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import ChatMessageComp from '../components/ChatMessage'

const suggestions = [
  'Which scooters have expired rego?',
  'Show me all unpaid fines',
  'Which vehicles are currently rented?',
  'Are there any upcoming pink slips due?',
]

export default function ChatPage() {
  const { messages, chatLoading, sendMessage, clearChat } = useStore()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || chatLoading) return
    sendMessage(trimmed)
    setInput('')
    inputRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-bg">
      {/* Header */}
      <div className="px-6 py-5 border-b border-border bg-surface flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">AI Assistant</h1>
          <p className="text-text-muted text-sm mt-0.5">Ask anything about your fleet</p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="text-sm text-text-muted hover:text-text-primary transition-colors font-medium"
          >
            Clear chat
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
            <div className="w-16 h-16 rounded-2xl bg-purple-bg flex items-center justify-center text-purple mb-5">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <h2 className="text-text-primary font-semibold text-lg mb-2">Fleet AI Assistant</h2>
            <p className="text-text-muted text-sm max-w-sm mb-8">
              Ask questions about your fleet, fines, rego dates, renters, or anything else.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => { setInput(s); inputRef.current?.focus() }}
                  className="text-left text-sm px-4 py-3 bg-surface border border-border rounded-xl text-text-secondary hover:text-text-primary hover:border-accent/40 hover:bg-accent-bg transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m) => (
              <ChatMessageComp key={m.id} message={m} />
            ))}
            {chatLoading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-purple-bg flex items-center justify-center text-purple text-xs font-bold shrink-0">
                  AI
                </div>
                <div className="bg-surface border border-border rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-text-muted animate-bounce [animation-delay:0ms]" />
                  <span className="w-2 h-2 rounded-full bg-text-muted animate-bounce [animation-delay:150ms]" />
                  <span className="w-2 h-2 rounded-full bg-text-muted animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Input */}
      <div className="px-6 py-4 border-t border-border bg-surface">
        <form onSubmit={handleSubmit} className="flex gap-3 items-end">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your fleet..."
            className="flex-1 bg-surface2 border border-border text-text-primary placeholder-text-muted text-sm rounded-xl px-4 py-3 focus:outline-none focus:border-accent transition-colors resize-none max-h-32"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />
          <button
            type="submit"
            disabled={!input.trim() || chatLoading}
            className="w-10 h-10 rounded-xl bg-accent text-white flex items-center justify-center hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
        <p className="text-xs text-text-muted mt-2 text-center">
          Press Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}
