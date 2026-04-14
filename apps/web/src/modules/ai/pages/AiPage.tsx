import { Outlet } from 'react-router-dom';
import { AiSidebar } from '../components/chat/AiSidebar';

export function AiPage() {
  return (
    <div className="flex h-[calc(100vh-4rem)] border rounded-xl overflow-hidden bg-background shadow-sm mt-4">
      <AiSidebar />
      <div className="flex flex-col flex-1 min-w-0 bg-muted/5 relative">
        <Outlet />
      </div>
    </div>
  );
}
