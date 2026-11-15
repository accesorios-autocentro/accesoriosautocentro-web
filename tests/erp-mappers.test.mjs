import test from "node:test";
import assert from "node:assert/strict";
import {
  productFromRow,
  invoiceFromRow,
  checkFromRow,
  contactFromRow,
  paymentFromRow
} from "../erp-mappers.mjs";

test("productFromRow: converts Postgres numeric/int strings to JS numbers and defaults cleanly", () => {
  const mapped = productFromRow({
    id: "uuid-1",
    code: "OPT-HIL-16",
    name: "Óptica Hilux",
    description: "Desc",
    category: "Faros y Ópticas",
    brand: "Toyota",
    model: "Hilux",
    year_start: "2016",
    year_end: 2020,
    price: "94000.50",
    stock: "4",
    image_url: "https://example.com/img.jpg"
  });

  assert.equal(mapped.id, "uuid-1");
  assert.equal(mapped.year_start, 2016);
  assert.equal(mapped.year_end, 2020);
  assert.equal(mapped.price, 94000.5);
  assert.equal(mapped.stock, 4);
  assert.equal(productFromRow(null), null);
});

test("invoiceFromRow: maps snake_case sale and purchase rows to camelCase Mini-ERP objects", () => {
  const sale = invoiceFromRow({
    id: "inv-1",
    type: "sale",
    invoice_type: "FACTURA_A",
    number: "0001-00000012",
    date: "2026-11-15",
    client_name: "Taller Sur",
    client_cuit: "20-12345678-9",
    client_iva: "Responsable Inscripto",
    client_address: "Av. Pellegrini 1200",
    payment_term: "CTA_CTE",
    items: [{ name: "Filtro", qty: 2, price: 5000, vatRate: 21, subtotal: 10000 }],
    neto_21: "10000.00",
    iva_21: "2100.00",
    neto_total: "10000.00",
    iva_total: "2100.00",
    perc_iibb: "300.00",
    perc_iva: "0.00",
    perc_total: "300.00",
    total: "12400.00",
    pending_balance: "12400.00",
    status: "pending"
  });

  assert.equal(sale.invoiceType, "FACTURA_A");
  assert.equal(sale.clientName, "Taller Sur");
  assert.equal(sale.paymentTerm, "CTA_CTE");
  assert.equal(sale.neto21, 10000);
  assert.equal(sale.iva21, 2100);
  assert.equal(sale.percIIBB, 300);
  assert.equal(sale.percTotal, 300);
  assert.equal(sale.total, 12400);
  assert.equal(sale.pendingBalance, 12400);
  assert.equal(sale.status, "pending");
  assert.equal(sale.items.length, 1);

  const purchase = invoiceFromRow({
    id: "inv-2",
    type: "purchase",
    invoice_type: "FACTURA_A",
    number: "0003-00004411",
    date: "2026-11-14",
    supplier_name: "Dist. Norte",
    supplier_cuit: "30-99887766-1",
    category: "Mercadería",
    payment_method: "CHEQUE_CARTERA",
    exempt: "500.00",
    total: "5500.00",
    pending_balance: "1500.00",
    status: "partial"
  });

  assert.equal(purchase.supplierName, "Dist. Norte");
  assert.equal(purchase.paymentMethod, "CHEQUE_CARTERA");
  assert.equal(purchase.exempt, 500);
  assert.equal(purchase.status, "partial");
});

test("checkFromRow, contactFromRow, paymentFromRow: map fields and numeric amounts accurately", () => {
  const chk = checkFromRow({
    id: "chk-1",
    direction: "RECEIVED",
    status: "IN_PORTFOLIO",
    bank: "Banco Nación",
    number: "998811",
    due_date: "2026-12-01",
    drawer: "Juan",
    client_name: "Taller Sur",
    amount: "45000.00",
    received_date: "2026-11-15",
    deposited_date: null,
    endorsed_to: null
  });
  assert.equal(chk.dueDate, "2026-12-01");
  assert.equal(chk.clientName, "Taller Sur");
  assert.equal(chk.amount, 45000);
  assert.equal(chk.depositedDate, null);

  const contact = contactFromRow({
    id: "cnt-1",
    type: "supplier",
    name: "Warnes Repuestos",
    cuit: "30-11223344-5",
    iva_condition: "Responsable Inscripto",
    category: "Mercadería"
  });
  assert.equal(contact.type, "supplier");
  assert.equal(contact.ivaCondition, "Responsable Inscripto");
  assert.equal(contact.category, "Mercadería");

  const pay = paymentFromRow({
    id: "pay-1",
    direction: "CLIENT_COLLECTION",
    contact_name: "Taller Sur",
    date: "2026-11-15",
    method: "TRANSFERENCIA",
    amount: "6000.00",
    imputations: [{ invoiceId: "inv-1", amount: 6000 }]
  });
  assert.equal(pay.contactName, "Taller Sur");
  assert.equal(pay.amount, 6000);
  assert.equal(pay.imputations[0].invoiceId, "inv-1");
});
