import { handler } from '@/lib/api';

export const GET = handler(({ user }) => user);
