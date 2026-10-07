import { handler, created } from '@/lib/api';
import { createExpense, listExpenses } from '@/lib/domain/service';

export const GET = handler(({ query }) => listExpenses(query));
export const POST = handler(({ body, user }) => created(createExpense(body, user)), { perm: 'expenses.write' });
