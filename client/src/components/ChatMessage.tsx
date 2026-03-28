import type { ChatMessage as ChatMessageType } from '../types'

interface ChatMessageProps {
  message: ChatMessageType
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${
          isUser ? 'bg-accent text-white' : 'bg-purple-bg text-purple'
        }`}
      >
        {isUser ? 'U' : 'AI'}
      </div>

      {/* Bubble */}
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'bg-accent text-white rounded-tr-sm'
            : 'bg-surface border border-border text-text-primary rounded-tl-sm'
        }`}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
        <p className={`text-[10px] mt-1.5 ${isUser ? 'text-white/60' : 'text-text-muted'}`}>
          {new Date(message.timestamp).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  )
}
