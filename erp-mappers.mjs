// erp-mappers.mjs — Mapeo puro snake_case (PostgreSQL) <-> camelCase (JavaScript Mini-ERP)

/**
 * Normaliza una fila de la tabla `public.products`.
 * @param {Record<string, any>} row
 */
export function productFromRow(row) {
  if (!row) return null;
  return {
    id: row.id || "",
    code: row.code || "",
    name: row.name || "",
    description: row.description || "",
    category: row.category || "",
    brand: row.brand || "",
    model: row.model || "",
    year_start: row.year_start != null ? Number(row.year_start) : null,
    year_end: row.year_end != null ? Number(row.year_end) : null,
    price: Number(row.price || 0),
    stock: Number(row.stock || 0),
    image_url: row.image_url || "",
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

/**
 * Normaliza una fila de la tabla `public.invoices` a formato camelCase usado por erp-logic.mjs.
 * @param {Record<string, any>} row
 */
export function invoiceFromRow(row) {
  if (!row) return null;
  return {
    id: row.id || "",
    type: row.type || "sale",
    invoiceType: row.invoice_type || "",
    number: row.number || "",
    date: row.date || "",
    clientName: row.client_name || "",
    clientCuit: row.client_cuit || "",
    clientIva: row.client_iva || "",
    clientAddress: row.client_address || "",
    supplierName: row.supplier_name || "",
    supplierCuit: row.supplier_cuit || "",
    category: row.category || "",
    paymentTerm: row.payment_term || "",
    paymentMethod: row.payment_method || "",
    items: Array.isArray(row.items) ? row.items : [],
    neto21: Number(row.neto_21 || 0),
    neto105: Number(row.neto_105 || 0),
    netoTotal: Number(row.neto_total || 0),
    iva21: Number(row.iva_21 || 0),
    iva105: Number(row.iva_105 || 0),
    ivaTotal: Number(row.iva_total || 0),
    percIIBB: Number(row.perc_iibb || 0),
    percIVA: Number(row.perc_iva || 0),
    percTotal: Number(row.perc_total || 0),
    exempt: Number(row.exempt || 0),
    total: Number(row.total || 0),
    pendingBalance: Number(row.pending_balance || 0),
    status: row.status || "pending",
    created_at: row.created_at || null
  };
}

/**
 * Normaliza una fila de la tabla `public.checks`.
 * @param {Record<string, any>} row
 */
export function checkFromRow(row) {
  if (!row) return null;
  return {
    id: row.id || "",
    direction: row.direction || "RECEIVED",
    status: row.status || "IN_PORTFOLIO",
    bank: row.bank || "",
    number: row.number || "",
    dueDate: row.due_date || "",
    drawer: row.drawer || "",
    clientName: row.client_name || "",
    amount: Number(row.amount || 0),
    receivedDate: row.received_date || "",
    depositedDate: row.deposited_date || null,
    endorsedTo: row.endorsed_to || "",
    endorsedDate: row.endorsed_date || "",
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

/**
 * Normaliza una fila de la tabla `public.contacts`.
 * @param {Record<string, any>} row
 */
export function contactFromRow(row) {
  if (!row) return null;
  return {
    id: row.id || "",
    type: row.type || "client",
    name: row.name || "",
    cuit: row.cuit || "",
    address: row.address || "",
    ivaCondition: row.iva_condition || "",
    category: row.category || "",
    created_at: row.created_at || null
  };
}

/**
 * Normaliza una fila de la tabla `public.payments`.
 * @param {Record<string, any>} row
 */
export function paymentFromRow(row) {
  if (!row) return null;
  return {
    id: row.id || "",
    direction: row.direction || "CLIENT_COLLECTION",
    contactName: row.contact_name || "",
    date: row.date || "",
    method: row.method || "",
    amount: Number(row.amount || 0),
    imputations: Array.isArray(row.imputations) ? row.imputations : [],
    created_at: row.created_at || null
  };
}
