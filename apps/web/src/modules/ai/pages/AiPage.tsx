import { AiChat } from '../components/chat/AiChat';

export function AiPage() {
  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="mb-6">
         <h1 className="text-2xl font-bold tracking-tight text-foreground">AI</h1>
         <p className="text-muted-foreground mt-1">
           Interact dynamically with your connected data in real-time.
         </p>
      </div>
      <div className="flex-1 w-full max-w-5xl mx-auto min-h-0">
        <AiChat />
      </div>
    </div>
  );
}
