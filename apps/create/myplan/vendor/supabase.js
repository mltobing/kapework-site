// Local adapter for vendored Supabase; no CDN is required.
import { supabase } from './supabase.umd.js';
export const createClient = supabase.createClient;
