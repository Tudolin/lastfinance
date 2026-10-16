import { serve } from 'inngest/next';
import { functions, inngest } from '@/server/jobs/inngest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Cada invocação executa um passo curto; 60 s dá folga para uma página de 500 transações.
export const maxDuration = 60;

export const { GET, POST, PUT } = serve({ client: inngest, functions });
