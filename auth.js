// ============================================================
// auth.js — Google login + role detection
// ============================================================
import { supabase } from './supabase.js';
import { getConfig } from './db.js';

const SCHOOL_DOMAIN = 'dishs.tp.edu.tw';

// Sign in with Google (Supabase handles OAuth)
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
  redirectTo: 'https://jtsuc123.github.io/dis-service-hrs/',
},
  });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.reload();
}

// Get the current session user
export async function getUser() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user ?? null;
}

// Determine role from email + config
export async function getUserRole() {
  const user = await getUser();
  if (!user) return { role: 'unauthenticated', email: '', displayName: '' };

  const email = user.email?.toLowerCase().trim() ?? '';
  const displayName = user.user_metadata?.full_name ?? '';
  const domain = email.split('@')[1] ?? '';

  if (domain !== SCHOOL_DOMAIN) {
    return { role: 'no_access', email, displayName };
  }

  // Check super admins
  const superAdmins = await getConfig('super_admins', []);
  if (superAdmins.map(e => e.toLowerCase()).includes(email)) {
    return { role: 'super_admin', email, displayName };
  }

  const localPart = email.split('@')[0] ?? '';

  // Numeric local part = student ID
  if (/^\d+$/.test(localPart.replace(/-/g, ''))) {
    return { role: 'student', email, displayName };
  }

  // Non-numeric dishs email = teacher (may have orgs assigned or not)
  const orgEditors = await getConfig('org_editors', {});
  const myOrgs = Object.keys(orgEditors).filter(org =>
    (orgEditors[org] ?? []).map(e => e.toLowerCase()).includes(email)
  );
  return { role: 'teacher', email, displayName, orgs: myOrgs };
}