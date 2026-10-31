/** One origin-wide Kapework auth client; Ma access is enforced separately by RLS and grants. */
import { getClient } from '/shared/auth.js';
export const supabase = await getClient();
