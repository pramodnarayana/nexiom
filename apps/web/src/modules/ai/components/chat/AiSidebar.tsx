import { Link, useLocation } from 'react-router-dom';
import { Plus, MessageSquare } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { useConversations } from '../../api/queries';

export function AiSidebar() {
  const { data: conversations, isLoading } = useConversations();
  const location = useLocation();

  return (
    <div className="w-64 border-r border-border bg-muted/10 h-full flex flex-col">
      <div className="p-4">
        <Button asChild className="w-full justify-start gap-2" variant="outline">
          <Link to="/dashboard/ai">
            <Plus className="w-4 h-4" />
            New Chat
          </Link>
        </Button>
      </div>
      
      <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
        {isLoading ? (
          <div className="px-4 py-2 text-xs text-muted-foreground">Loading history...</div>
        ) : conversations?.length === 0 ? (
          <div className="px-4 py-2 text-xs text-muted-foreground">No recent chats.</div>
        ) : (
          conversations?.map((conv: { id: string; title: string }) => {
            const isActive = location.pathname === `/dashboard/ai/chat/${conv.id}`;
            return (
              <Link
                key={conv.id}
                to={`/dashboard/ai/chat/${conv.id}`}
                className={`flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors ${
                  isActive 
                    ? 'bg-primary/10 text-primary font-medium' 
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                }`}
              >
                <MessageSquare className="w-4 h-4 shrink-0" />
                <span className="truncate">{conv.title}</span>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
