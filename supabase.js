// ============================================================
// supabase.js — Supabase client
// Replace the two values below with your own from:
// Supabase Dashboard → Project Settings → API
// ============================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://xemsndgnkfsmheugcwlf.supabase.co';     
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhlbXNuZGdua2ZzbWhldWdjd2xmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NDYzMTcsImV4cCI6MjA5MjMyMjMxN30._BYh-KfELtSCgG-vPJ9f875iwfPm6ahHrg0sSTJhE2A'; 
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);