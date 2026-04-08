import { useEffect, useRef, useState } from 'react';
import { useChat, type UIMessage } from '@ai-sdk/react';
import ReactMarkdown from 'react-markdown';
import { Send, Bot, User, Sparkles } from 'lucide-react';
import { Input } from '@/shared/components/ui/input';
import { Button } from '@/shared/components/ui/button';
import { Avatar, AvatarFallback } from '@/shared/components/ui/avatar';
export function AiChat() {
  // Safely inject stream interface overrides without breaking TS strict mode
  const options: Record<string, unknown> = {
    api: '/api/ai/chat',
    streamProtocol: 'ui-message-stream'
  };
  const { messages, status, sendMessage } = useChat(options as Parameters<typeof useChat>[0]);
  const [input, setInput] = useState('');

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!input.trim()) {
      return;
    }
    if (status === 'submitted' || status === 'streaming') {
      return;
    }

    try {
      sendMessage({ text: input });
    } catch (err) {
      console.error('Error while sending message:', err);
    }

    setInput('');
  };

  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-background border border-border shadow-sm rounded-xl overflow-hidden relative">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-muted/20">
        <div className="bg-primary/10 p-2 rounded-lg">
          <Sparkles className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">Nexiom AI</h2>
          <p className="text-xs text-muted-foreground">Connected to your live enterprise data</p>
        </div>
      </div>

      {/* Messages Area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4 text-muted-foreground opacity-60">
            <Bot className="w-12 h-12 mb-2" />
            <p className="text-sm max-w-[250px]">
              Ask me to pull invoices, display loads, or execute mutations across your connected apps.
            </p>
          </div>
        )}

        {messages.map((m: UIMessage) => {
          return (
            <div key={m.id} className={`flex gap-4 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'assistant' && (
                <Avatar className="w-8 h-8 shrink-0 mt-1">
                  <AvatarFallback className="bg-primary/10 text-primary"><Bot size={16} /></AvatarFallback>
                </Avatar>
              )}

              <div className={`flex flex-col gap-2 max-w-[85%] ${m.role === 'user' ? 'items-end' : 'items-start'}`}>


                {/* Text Message Content (Fallback or from Parts) */}
                {(Array.isArray(m.parts) && m.parts.some((p) => p.type === 'text')) && (
                  <div
                    className={`px-4 py-3 rounded-2xl text-sm ${m.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-tr-sm'
                      : 'bg-muted/40 border border-border text-foreground rounded-tl-sm'
                      }`}
                  >
                    <div className="prose prose-sm dark:prose-invert max-w-none break-words">
                      <ReactMarkdown>
                        {String(Array.isArray(m.parts) ? m.parts?.filter((p) => p.type === 'text').map((p) => 'text' in p ? p.text : '').join('\n\n') : '')}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}

                {/* Generative UI Tool Cards (From Parts) */}
                {/* Temporarily hidden by request:
              {m.parts?.filter((p: any) => p.type === 'dynamic-tool').map((toolPart: any) => {
                const toolCallId = toolPart.toolCallId;
                const toolName = toolPart.toolName;
                const isFinished = toolPart.state === 'output-available' || 'output' in toolPart;

                return (
                  <div key={toolCallId} className="w-full mt-2">
                    <ObjectCard
                      toolName={toolName}
                      args={toolPart.input || toolPart.args}
                      result={toolPart.output || toolPart.result}
                      isLoading={!isFinished}
                    />
                  </div>
                );
              })}
              */}

                {/* Fallback for classic toolInvocations (Pre-v3 stream protocol) */}
                {/* Temporarily hidden by request:
              {(!m.parts || (Array.isArray(m.parts) && m.parts.length === 0)) && Array.isArray(m.toolInvocations) && m.toolInvocations?.map((toolInvocation: Record<string, unknown>) => {
                const toolCallId = String(toolInvocation.toolCallId);
                const toolName = String(toolInvocation.toolName);

                if ('result' in toolInvocation) {
                  return (
                    <div key={toolCallId} className="w-full mt-2">
                      <ObjectCard
                        toolName={toolName}
                        args={toolInvocation.args}
                        result={toolInvocation.result}
                        isLoading={false}
                      />
                    </div>
                  );
                } else {
                  return (
                    <div key={toolCallId} className="w-full mt-2">
                      <ObjectCard
                        toolName={toolName}
                        args={toolInvocation.args}
                        isLoading={true}
                      />
                    </div>
                  );
                }
              })}
              */}
              </div>

              {m.role === 'user' && (
                <Avatar className="w-8 h-8 shrink-0 mt-1">
                  <AvatarFallback className="bg-foreground text-background"><User size={16} /></AvatarFallback>
                </Avatar>
              )}
            </div>
          );
        })}

        {/* Synthetic Loading Indicator for simple text generation streams */}
        {(status === 'submitted' || status === 'streaming') && Array.isArray(messages) && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
          <div className="flex gap-4 justify-start animate-pulse">
            <Avatar className="w-8 h-8 shrink-0 mt-1">
              <AvatarFallback className="bg-primary/10 text-primary"><Bot size={16} /></AvatarFallback>
            </Avatar>
            <div className="px-4 py-3 rounded-2xl text-sm bg-muted/40 border border-border text-foreground rounded-tl-sm flex items-center space-x-1">
              <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" />
              <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce delay-75" />
              <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce delay-150" />
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 bg-background border-t border-border">
        <form onSubmit={handleSubmit} className="flex gap-2 relative">
          <Input
            value={input || ''}
            onChange={handleInputChange}
            placeholder="Type your message..."
            className="flex-1 pr-12 rounded-full border-border bg-muted/10 shadow-sm focus-visible:ring-primary/20"
            disabled={status === 'submitted' || status === 'streaming'}
          />
          <Button
            type="submit"
            size="icon"
            disabled={status === 'submitted' || status === 'streaming' || !(input || '').trim()}
            className="absolute right-1 top-1 bottom-1 h-auto w-8 rounded-full"
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </Button>
        </form>
        <div className="text-[10px] text-center mt-3 text-muted-foreground font-medium flex items-center justify-center gap-1.5 opacity-70">
          <Sparkles className="w-3 h-3" /> AI can make mistakes. Check important info.
        </div>
      </div>
    </div>
  );
}