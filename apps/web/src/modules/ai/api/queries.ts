import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';

export type AiConversation = {
  id: string;
  tenantId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type AiMessageInfo = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  status: string;
  createdAt: string;
};

export function useConversations() {
  return useQuery({
    queryKey: ['ai', 'conversations'],
    queryFn: async () => {
      const { data } = await apiClient.get<{ success: boolean; data: AiConversation[] }>('/ai/conversations');
      return data.data;
    },
  });
}

export function useConversationMessages(conversationId?: string) {
  return useQuery({
    queryKey: ['ai', 'conversations', conversationId, 'messages'],
    queryFn: async () => {
      if (!conversationId) return [];
      const { data } = await apiClient.get<{ success: boolean; data: AiMessageInfo[] }>(`/ai/conversations/${conversationId}/messages`);
      return data.data;
    },
    enabled: !!conversationId,
  });
}
