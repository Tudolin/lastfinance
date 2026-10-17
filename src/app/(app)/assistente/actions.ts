'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { deleteAllConversations, deleteConversation } from '@/server/agent/run';

export async function deleteConversationAction(id: string) {
  await deleteConversation(z.string().uuid().parse(id));
  revalidatePath('/assistente');
}

export async function deleteAllConversationsAction() {
  await deleteAllConversations();
  revalidatePath('/assistente');
}
