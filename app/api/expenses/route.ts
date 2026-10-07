import { handler, created } from '@/lib/api';
import { createExpense, listExpenses } from '@/lib/domain/service';

export const GET = handler(({ query }) => listExpenses(query));
export const POST = handler(async ({ body, user }) => created(await createExpense(body, user)), { perm: 'expenses.write' });
