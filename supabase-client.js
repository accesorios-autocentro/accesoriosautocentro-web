import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
export {
  productFromRow,
  invoiceFromRow,
  checkFromRow,
  contactFromRow,
  paymentFromRow
} from "./erp-mappers.mjs?v=1";

// Configuración pública de Supabase (segura para frontend cuando RLS está activo)
export const SUPABASE_URL = "https://irimvfzbtdlhlsnzwzii.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_hzajuq5dZpsdnvaL528t0A_ScJ-_cxa";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
