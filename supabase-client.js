import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { productFromRow } from "./erp-mappers.mjs?v=1";
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

const DEFAULT_PRODUCT_COLUMNS =
  "id,code,name,description,category,brand,model,year_start,year_end,price,stock,image_url";

/**
 * Descarga todos los productos de Supabase superando el límite por defecto de 1.000 filas.
 * Ejecuta lotes de 1.000 ordenados de forma determinística (updated_at DESC, id ASC).
 */
export async function fetchAllProducts({
  client = supabase,
  columns = DEFAULT_PRODUCT_COLUMNS,
  pageSize = 1000,
  concurrency = 4
} = {}) {
  const firstPage = await client
    .from("products")
    .select(columns, { count: "exact" })
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true })
    .range(0, pageSize - 1);

  if (firstPage.error) {
    throw firstPage.error;
  }

  const allRows = [...(firstPage.data || [])];
  const totalCount = Number(firstPage.count || allRows.length);

  if (totalCount > pageSize) {
    const ranges = [];
    for (let start = pageSize; start < totalCount; start += pageSize) {
      ranges.push([start, Math.min(start + pageSize - 1, totalCount - 1)]);
    }

    for (let i = 0; i < ranges.length; i += concurrency) {
      const slice = ranges.slice(i, i + concurrency);
      const responses = await Promise.all(
        slice.map(([from, to]) =>
          client
            .from("products")
            .select(columns)
            .order("updated_at", { ascending: false })
            .order("id", { ascending: true })
            .range(from, to)
        )
      );

      for (const res of responses) {
        if (res.error) throw res.error;
        if (res.data) allRows.push(...res.data);
      }
    }
  }

  return allRows.map(productFromRow);
}
