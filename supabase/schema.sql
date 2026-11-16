-- ============================================================================
-- Accesorios Autocentro / Carlitos Autopartes — Supabase PostgreSQL Schema
-- Ejecutar completo en: Supabase Dashboard -> SQL Editor -> New query -> Run
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. Helper de autorización Admin (RLS + RPCs)
-- Coincide con la lista blanca del panel de control:
--   - accesoriosautocentro@gmail.com
--   - leoneldariogarcia@gmail.com
--   - carlitos@carlitosautopartes.com
--   - cualquier usuario con dominio @carlitosautopartes.com
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.role() = 'authenticated' AND (
    LOWER(COALESCE(auth.jwt() ->> 'email', '')) IN (
      'accesoriosautocentro@gmail.com',
      'leoneldariogarcia@gmail.com',
      'carlitos@carlitosautopartes.com'
    )
    OR LOWER(COALESCE(auth.jwt() ->> 'email', '')) LIKE '%@carlitosautopartes.com'
  );
$$;

-- ----------------------------------------------------------------------------
-- 2. Tablas del Catálogo Público y Mini-ERP
-- ----------------------------------------------------------------------------

-- Catálogo de Repuestos y Accesorios
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT DEFAULT '',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  year_start INTEGER,
  year_end INTEGER,
  price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  image_url TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_updated_at ON public.products (updated_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products (category);
CREATE INDEX IF NOT EXISTS idx_products_brand ON public.products (brand);
CREATE INDEX IF NOT EXISTS idx_products_code ON public.products (code);

-- Comprobantes (Ventas y Compras)
CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('sale', 'purchase')),
  invoice_type TEXT NOT NULL,
  number TEXT NOT NULL,
  date DATE NOT NULL,
  client_name TEXT,
  client_cuit TEXT,
  client_iva TEXT,
  client_address TEXT,
  supplier_name TEXT,
  supplier_cuit TEXT,
  category TEXT,
  payment_term TEXT,
  payment_method TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  neto_21 NUMERIC(12, 2) NOT NULL DEFAULT 0,
  neto_105 NUMERIC(12, 2) NOT NULL DEFAULT 0,
  neto_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  iva_21 NUMERIC(12, 2) NOT NULL DEFAULT 0,
  iva_105 NUMERIC(12, 2) NOT NULL DEFAULT 0,
  iva_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  perc_iibb NUMERIC(12, 2) NOT NULL DEFAULT 0,
  perc_iva NUMERIC(12, 2) NOT NULL DEFAULT 0,
  perc_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  exempt NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
  pending_balance NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (pending_balance >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('paid', 'partial', 'pending', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_type_date ON public.invoices (type, date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices (status);

-- Clientes y Proveedores
CREATE TABLE IF NOT EXISTS public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('client', 'supplier')),
  name TEXT NOT NULL,
  cuit TEXT DEFAULT '',
  address TEXT DEFAULT '',
  iva_condition TEXT DEFAULT '',
  category TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contacts_type_name ON public.contacts (type, name);

-- Cartera de Cheques
CREATE TABLE IF NOT EXISTS public.checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (direction IN ('RECEIVED', 'ISSUED')),
  status TEXT NOT NULL DEFAULT 'IN_PORTFOLIO' CHECK (status IN ('IN_PORTFOLIO', 'DEPOSITED', 'ENDORSED', 'REJECTED')),
  bank TEXT NOT NULL,
  number TEXT NOT NULL,
  due_date DATE,
  drawer TEXT DEFAULT '',
  client_name TEXT DEFAULT '',
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  received_date DATE,
  deposited_date DATE,
  endorsed_to TEXT,
  endorsed_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_updated_at ON public.products (updated_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products (category);
CREATE INDEX IF NOT EXISTS idx_products_brand ON public.products (brand);
CREATE INDEX IF NOT EXISTS idx_products_code ON public.products (code);

CREATE INDEX IF NOT EXISTS idx_checks_status_due ON public.checks (status, due_date DESC);

-- Pagos y Cobranzas Imputadas
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction TEXT NOT NULL CHECK (direction IN ('CLIENT_COLLECTION', 'SUPPLIER_PAYMENT')),
  contact_name TEXT NOT NULL,
  date DATE NOT NULL,
  method TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  imputations JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_date ON public.payments (date DESC);

-- ----------------------------------------------------------------------------
-- 3. Row Level Security (RLS)
-- ----------------------------------------------------------------------------
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Products: lectura pública (tienda), escritura solo admin
DROP POLICY IF EXISTS "products_public_read" ON public.products;
CREATE POLICY "products_public_read" ON public.products
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "products_admin_insert" ON public.products;
CREATE POLICY "products_admin_insert" ON public.products
  FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "products_admin_update" ON public.products;
CREATE POLICY "products_admin_update" ON public.products
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "products_admin_delete" ON public.products;
CREATE POLICY "products_admin_delete" ON public.products
  FOR DELETE USING (public.is_admin());

-- Tablas ERP: solo admins autenticados
DROP POLICY IF EXISTS "invoices_admin_all" ON public.invoices;
CREATE POLICY "invoices_admin_all" ON public.invoices
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "contacts_admin_all" ON public.contacts;
CREATE POLICY "contacts_admin_all" ON public.contacts
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "checks_admin_all" ON public.checks;
CREATE POLICY "checks_admin_all" ON public.checks
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "payments_admin_all" ON public.payments;
CREATE POLICY "payments_admin_all" ON public.payments
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ----------------------------------------------------------------------------
-- 4. Publicación Supabase Realtime
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['products', 'invoices', 'contacts', 'checks', 'payments'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    END IF;
  END LOOP;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Funciones Atómicas RPC (Transacciones ACID con bloqueos FOR UPDATE)
-- ----------------------------------------------------------------------------

-- 5A. Registrar Venta (descuenta stock, crea comprobante, ingresa cheque si aplica, crea cliente si es nuevo)
CREATE OR REPLACE FUNCTION public.rpc_save_sale(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_invoice_type TEXT := p_payload ->> 'invoiceType';
  v_number TEXT := COALESCE(p_payload ->> 'number', '');
  v_date DATE := (p_payload ->> 'date')::DATE;
  v_client_name TEXT := TRIM(COALESCE(p_payload ->> 'clientName', ''));
  v_client_cuit TEXT := TRIM(COALESCE(p_payload ->> 'clientCuit', ''));
  v_client_iva TEXT := COALESCE(p_payload ->> 'clientIva', '');
  v_client_address TEXT := TRIM(COALESCE(p_payload ->> 'clientAddress', ''));
  v_payment_term TEXT := COALESCE(p_payload ->> 'paymentTerm', 'CONTADO_EFECTIVO');
  v_items JSONB := COALESCE(p_payload -> 'items', '[]'::jsonb);
  v_neto_21 NUMERIC := ROUND(COALESCE((p_payload ->> 'neto21')::NUMERIC, 0), 2);
  v_neto_105 NUMERIC := ROUND(COALESCE((p_payload ->> 'neto105')::NUMERIC, 0), 2);
  v_neto_total NUMERIC := ROUND(COALESCE((p_payload ->> 'netoTotal')::NUMERIC, 0), 2);
  v_iva_21 NUMERIC := ROUND(COALESCE((p_payload ->> 'iva21')::NUMERIC, 0), 2);
  v_iva_105 NUMERIC := ROUND(COALESCE((p_payload ->> 'iva105')::NUMERIC, 0), 2);
  v_iva_total NUMERIC := ROUND(COALESCE((p_payload ->> 'ivaTotal')::NUMERIC, 0), 2);
  v_perc_iibb NUMERIC := ROUND(COALESCE((p_payload ->> 'percIIBB')::NUMERIC, 0), 2);
  v_perc_iva NUMERIC := ROUND(COALESCE((p_payload ->> 'percIVA')::NUMERIC, 0), 2);
  v_perc_total NUMERIC := ROUND(COALESCE((p_payload ->> 'percTotal')::NUMERIC, 0), 2);
  v_total NUMERIC := ROUND(COALESCE((p_payload ->> 'total')::NUMERIC, 0), 2);
  v_is_cta_cte BOOLEAN := (v_payment_term = 'CTA_CTE');
  v_pending_balance NUMERIC;
  v_status TEXT;
  v_invoice_id UUID;
  v_prod_rec RECORD;
  v_stock INTEGER;
  v_prod_name TEXT;
  v_check JSONB := p_payload -> 'checkData';
  v_norm_client TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado: usuario no autorizado.';
  END IF;

  IF v_client_name = '' THEN
    RAISE EXCEPTION 'Ingresá el nombre o razón social del cliente.';
  END IF;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'El total del comprobante debe ser mayor a 0.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.invoices
    WHERE type = 'sale'
      AND invoice_type = v_invoice_type
      AND LOWER(TRIM(number)) = LOWER(TRIM(v_number))
  ) THEN
    RAISE EXCEPTION 'Ya existe un comprobante % con el número %.', REPLACE(v_invoice_type, '_', ' '), v_number;
  END IF;

  -- Validar y descontar stock agrupado por producto (con bloqueo de fila FOR UPDATE)
  FOR v_prod_rec IN
    SELECT
      (elem ->> 'productId')::UUID AS product_id,
      SUM(GREATEST(1, COALESCE((elem ->> 'qty')::INTEGER, 1)))::INTEGER AS total_qty
    FROM jsonb_array_elements(v_items) AS elem
    WHERE NULLIF(TRIM(COALESCE(elem ->> 'productId', '')), '') IS NOT NULL
    GROUP BY (elem ->> 'productId')::UUID
    ORDER BY (elem ->> 'productId')::UUID
  LOOP
    SELECT stock, name INTO v_stock, v_prod_name
    FROM public.products
    WHERE id = v_prod_rec.product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Producto no encontrado en el inventario (%).', v_prod_rec.product_id;
    END IF;

    IF v_stock < v_prod_rec.total_qty THEN
      RAISE EXCEPTION 'Stock insuficiente para "%": pedís % y hay %.', v_prod_name, v_prod_rec.total_qty, v_stock;
    END IF;

    UPDATE public.products
    SET stock = stock - v_prod_rec.total_qty,
        updated_at = now()
    WHERE id = v_prod_rec.product_id;
  END LOOP;

  v_pending_balance := CASE WHEN v_is_cta_cte THEN v_total ELSE 0 END;
  v_status := CASE WHEN v_is_cta_cte THEN 'pending' ELSE 'paid' END;

  INSERT INTO public.invoices (
    type, invoice_type, number, date,
    client_name, client_cuit, client_iva, client_address,
    payment_term, items,
    neto_21, neto_105, neto_total,
    iva_21, iva_105, iva_total,
    perc_iibb, perc_iva, perc_total,
    total, pending_balance, status
  ) VALUES (
    'sale', v_invoice_type, v_number, v_date,
    v_client_name, v_client_cuit, v_client_iva, v_client_address,
    v_payment_term, v_items,
    v_neto_21, v_neto_105, v_neto_total,
    v_iva_21, v_iva_105, v_iva_total,
    v_perc_iibb, v_perc_iva, v_perc_total,
    v_total, v_pending_balance, v_status
  )
  RETURNING id INTO v_invoice_id;

  -- Cheque recibido en cartera si la venta fue CONTADO_CHEQUE
  IF v_payment_term = 'CONTADO_CHEQUE' AND v_check IS NOT NULL AND jsonb_typeof(v_check) = 'object' THEN
    IF TRIM(COALESCE(v_check ->> 'bank', '')) = '' OR TRIM(COALESCE(v_check ->> 'number', '')) = '' THEN
      RAISE EXCEPTION 'Completá banco y número del cheque recibido.';
    END IF;

    INSERT INTO public.checks (
      direction, status, bank, number, due_date, drawer, client_name, amount, received_date
    ) VALUES (
      'RECEIVED',
      'IN_PORTFOLIO',
      TRIM(v_check ->> 'bank'),
      TRIM(v_check ->> 'number'),
      NULLIF(TRIM(COALESCE(v_check ->> 'dueDate', '')), '')::DATE,
      COALESCE(NULLIF(TRIM(v_check ->> 'drawer'), ''), v_client_name),
      v_client_name,
      v_total,
      v_date
    );
  END IF;

  -- Crear contacto cliente si aún no existe
  v_norm_client := LOWER(REGEXP_REPLACE(v_client_name, '\s+', ' ', 'g'));
  IF NOT EXISTS (
    SELECT 1 FROM public.contacts
    WHERE type = 'client'
      AND LOWER(REGEXP_REPLACE(TRIM(name), '\s+', ' ', 'g')) = v_norm_client
  ) THEN
    INSERT INTO public.contacts (type, name, cuit, address, iva_condition)
    VALUES ('client', v_client_name, v_client_cuit, v_client_address, v_client_iva);
  END IF;

  RETURN jsonb_build_object('invoiceId', v_invoice_id);
END;
$$;

-- 5B. Registrar Compra (crea comprobante, endosa cheque si CHEQUE_CARTERA, suma stock opcional, crea proveedor)
CREATE OR REPLACE FUNCTION public.rpc_save_purchase(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_invoice_type TEXT := p_payload ->> 'invoiceType';
  v_number TEXT := COALESCE(p_payload ->> 'number', '');
  v_date DATE := (p_payload ->> 'date')::DATE;
  v_supplier_name TEXT := TRIM(COALESCE(p_payload ->> 'supplierName', ''));
  v_supplier_cuit TEXT := TRIM(COALESCE(p_payload ->> 'supplierCuit', ''));
  v_category TEXT := COALESCE(p_payload ->> 'category', '');
  v_payment_method TEXT := COALESCE(p_payload ->> 'paymentMethod', 'CONTADO_EFECTIVO');
  v_neto_21 NUMERIC := ROUND(COALESCE((p_payload ->> 'neto21')::NUMERIC, 0), 2);
  v_neto_105 NUMERIC := ROUND(COALESCE((p_payload ->> 'neto105')::NUMERIC, 0), 2);
  v_neto_total NUMERIC := ROUND(COALESCE((p_payload ->> 'netoTotal')::NUMERIC, 0), 2);
  v_iva_21 NUMERIC := ROUND(COALESCE((p_payload ->> 'iva21')::NUMERIC, 0), 2);
  v_iva_105 NUMERIC := ROUND(COALESCE((p_payload ->> 'iva105')::NUMERIC, 0), 2);
  v_iva_total NUMERIC := ROUND(COALESCE((p_payload ->> 'ivaTotal')::NUMERIC, 0), 2);
  v_perc_total NUMERIC := ROUND(COALESCE((p_payload ->> 'percTotal')::NUMERIC, 0), 2);
  v_exempt NUMERIC := ROUND(COALESCE((p_payload ->> 'exempt')::NUMERIC, 0), 2);
  v_total NUMERIC := ROUND(COALESCE((p_payload ->> 'total')::NUMERIC, 0), 2);
  v_stock_product_id UUID := NULLIF(TRIM(COALESCE(p_payload ->> 'stockProductId', '')), '')::UUID;
  v_stock_qty INTEGER := GREATEST(0, COALESCE((p_payload ->> 'stockQty')::INTEGER, 0));
  v_endorsed_check_id UUID := NULLIF(TRIM(COALESCE(p_payload ->> 'endorsedCheckId', '')), '')::UUID;
  v_check_rec RECORD;
  v_pending_balance NUMERIC := 0;
  v_status TEXT := 'paid';
  v_invoice_id UUID;
  v_norm_supplier TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado: usuario no autorizado.';
  END IF;

  IF v_supplier_name = '' THEN
    RAISE EXCEPTION 'Ingresá el proveedor o acreedor.';
  END IF;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'El total de la compra debe ser mayor a 0.';
  END IF;

  IF v_stock_product_id IS NOT NULL AND v_stock_qty <= 0 THEN
    RAISE EXCEPTION 'Indicá la cantidad a sumar al stock del repuesto elegido.';
  END IF;

  IF v_payment_method = 'CHEQUE_CARTERA' THEN
    IF v_endorsed_check_id IS NULL THEN
      RAISE EXCEPTION 'Elegí el cheque de cartera con el que se paga esta compra.';
    END IF;

    SELECT * INTO v_check_rec
    FROM public.checks
    WHERE id = v_endorsed_check_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'El cheque seleccionado ya no existe.';
    END IF;

    IF v_check_rec.status <> 'IN_PORTFOLIO' THEN
      RAISE EXCEPTION 'El cheque elegido ya no está en cartera (%).', v_check_rec.status;
    END IF;

    IF (v_check_rec.amount - v_total) > 0.009 THEN
      RAISE EXCEPTION 'El cheque ($%) supera el total de la compra ($%).', v_check_rec.amount, v_total;
    END IF;

    v_pending_balance := GREATEST(0, ROUND((v_total - v_check_rec.amount)::NUMERIC, 2));
    v_status := CASE
      WHEN v_pending_balance <= 0 THEN 'paid'
      WHEN v_pending_balance < v_total THEN 'partial'
      ELSE 'pending'
    END;

    UPDATE public.checks
    SET status = 'ENDORSED',
        endorsed_to = v_supplier_name,
        endorsed_date = v_date,
        updated_at = now()
    WHERE id = v_endorsed_check_id;
  ELSIF v_payment_method = 'CTA_CTE' THEN
    v_pending_balance := v_total;
    v_status := 'pending';
  ELSE
    v_pending_balance := 0;
    v_status := 'paid';
  END IF;

  -- Sumar stock opcional al inventario
  IF v_stock_product_id IS NOT NULL AND v_stock_qty > 0 THEN
    UPDATE public.products
    SET stock = stock + v_stock_qty,
        updated_at = now()
    WHERE id = v_stock_product_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'El repuesto seleccionado para ingresar stock no existe.';
    END IF;
  END IF;

  INSERT INTO public.invoices (
    type, invoice_type, number, date,
    supplier_name, supplier_cuit, category, payment_method,
    neto_21, neto_105, neto_total,
    iva_21, iva_105, iva_total,
    perc_total, exempt,
    total, pending_balance, status
  ) VALUES (
    'purchase', v_invoice_type, v_number, v_date,
    v_supplier_name, v_supplier_cuit, v_category, v_payment_method,
    v_neto_21, v_neto_105, v_neto_total,
    v_iva_21, v_iva_105, v_iva_total,
    v_perc_total, v_exempt,
    v_total, v_pending_balance, v_status
  )
  RETURNING id INTO v_invoice_id;

  -- Crear contacto proveedor si aún no existe
  v_norm_supplier := LOWER(REGEXP_REPLACE(v_supplier_name, '\s+', ' ', 'g'));
  IF NOT EXISTS (
    SELECT 1 FROM public.contacts
    WHERE type = 'supplier'
      AND LOWER(REGEXP_REPLACE(TRIM(name), '\s+', ' ', 'g')) = v_norm_supplier
  ) THEN
    INSERT INTO public.contacts (type, name, cuit, category)
    VALUES ('supplier', v_supplier_name, v_supplier_cuit, v_category);
  END IF;

  RETURN jsonb_build_object('invoiceId', v_invoice_id);
END;
$$;

-- 5C. Registrar Cobranza / Pago Imputado (actualiza saldos de comprobantes, cartera de cheques y tabla payments)
CREATE OR REPLACE FUNCTION public.rpc_save_payment(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_direction TEXT := COALESCE(p_payload ->> 'direction', '');
  v_contact_name TEXT := TRIM(COALESCE(p_payload ->> 'contactName', ''));
  v_date DATE := (p_payload ->> 'date')::DATE;
  v_method TEXT := COALESCE(p_payload ->> 'method', 'EFECTIVO');
  v_amount NUMERIC := ROUND(COALESCE((p_payload ->> 'amount')::NUMERIC, 0), 2);
  v_imputations JSONB := COALESCE(p_payload -> 'imputations', '[]'::jsonb);
  v_endorsed_check_id UUID := NULLIF(TRIM(COALESCE(p_payload ->> 'endorsedCheckId', '')), '')::UUID;
  v_check JSONB := p_payload -> 'checkData';
  v_check_rec RECORD;
  v_imp_rec RECORD;
  v_inv_rec RECORD;
  v_applied NUMERIC;
  v_new_balance NUMERIC;
  v_new_status TEXT;
  v_payment_id UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado: usuario no autorizado.';
  END IF;

  IF v_direction NOT IN ('CLIENT_COLLECTION', 'SUPPLIER_PAYMENT') THEN
    RAISE EXCEPTION 'Dirección de pago inválida.';
  END IF;

  IF v_contact_name = '' THEN
    RAISE EXCEPTION 'Seleccioná un contacto.';
  END IF;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'El monto a imputar debe ser mayor a 0.';
  END IF;

  -- Si es pago a proveedor con cheque de cartera, validar y endosar cheque
  IF v_direction = 'SUPPLIER_PAYMENT' AND v_method = 'CHEQUE_CARTERA' THEN
    IF v_endorsed_check_id IS NULL THEN
      RAISE EXCEPTION 'Elegí el cheque de cartera a endosar.';
    END IF;

    SELECT * INTO v_check_rec
    FROM public.checks
    WHERE id = v_endorsed_check_id
    FOR UPDATE;

    IF NOT FOUND OR v_check_rec.status <> 'IN_PORTFOLIO' THEN
      RAISE EXCEPTION 'El cheque seleccionado ya no está disponible en cartera.';
    END IF;

    UPDATE public.checks
    SET status = 'ENDORSED',
        endorsed_to = v_contact_name,
        endorsed_date = v_date,
        updated_at = now()
    WHERE id = v_endorsed_check_id;
  END IF;

  -- Actualizar saldos pendientes de los comprobantes imputados
  FOR v_imp_rec IN
    SELECT
      (elem ->> 'invoiceId')::UUID AS invoice_id,
      ROUND(COALESCE((elem ->> 'amount')::NUMERIC, 0), 2) AS applied_amount
    FROM jsonb_array_elements(v_imputations) AS elem
    ORDER BY (elem ->> 'invoiceId')::UUID
  LOOP
    v_applied := v_imp_rec.applied_amount;
    IF v_applied <= 0 THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_inv_rec
    FROM public.invoices
    WHERE id = v_imp_rec.invoice_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Comprobante no encontrado (%).', v_imp_rec.invoice_id;
    END IF;

    IF v_applied > ROUND((v_inv_rec.pending_balance + 0.01)::NUMERIC, 2) THEN
      RAISE EXCEPTION 'El monto imputado ($%) supera el saldo pendiente ($%) del comprobante %.',
        v_applied, v_inv_rec.pending_balance, v_inv_rec.number;
    END IF;

    v_new_balance := GREATEST(0, ROUND((v_inv_rec.pending_balance - v_applied)::NUMERIC, 2));
    v_new_status := CASE
      WHEN v_new_balance <= 0 THEN 'paid'
      WHEN v_new_balance < v_inv_rec.total THEN 'partial'
      ELSE 'pending'
    END;

    UPDATE public.invoices
    SET pending_balance = v_new_balance,
        status = v_new_status
    WHERE id = v_imp_rec.invoice_id;
  END LOOP;

  -- Si es cobranza de cliente con cheque de tercero, ingresarlo en cartera
  IF v_direction = 'CLIENT_COLLECTION' AND v_method = 'CHEQUE_TERCERO' THEN
    IF v_check IS NULL OR TRIM(COALESCE(v_check ->> 'bank', '')) = '' OR TRIM(COALESCE(v_check ->> 'number', '')) = '' THEN
      RAISE EXCEPTION 'Completá banco y número del cheque recibido.';
    END IF;

    INSERT INTO public.checks (
      direction, status, bank, number, due_date, drawer, client_name, amount, received_date
    ) VALUES (
      'RECEIVED',
      'IN_PORTFOLIO',
      TRIM(v_check ->> 'bank'),
      TRIM(v_check ->> 'number'),
      NULLIF(TRIM(COALESCE(v_check ->> 'dueDate', '')), '')::DATE,
      COALESCE(NULLIF(TRIM(v_check ->> 'drawer'), ''), v_contact_name),
      v_contact_name,
      v_amount,
      v_date
    );
  END IF;

  INSERT INTO public.payments (
    direction, contact_name, date, method, amount, imputations
  ) VALUES (
    v_direction, v_contact_name, v_date, v_method, v_amount, v_imputations
  )
  RETURNING id INTO v_payment_id;

  RETURN jsonb_build_object('paymentId', v_payment_id);
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Datos Iniciales del Catálogo (solo si la tabla products está vacía)
-- ----------------------------------------------------------------------------
INSERT INTO public.products (code, name, description, category, brand, model, year_start, year_end, price, stock, image_url)
SELECT * FROM (
  VALUES
    ('TAZ-14-CR', 'Taza Rueda Corsa 14" Cromada Original', 'Taza embellecedora universal adaptable rodado 14, acabado cromado resistente a alta temperatura.', 'Tazas y Molduras', 'Chevrolet', 'Corsa', 1998, 2016, 12500.00, 15, 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?q=80&w=600&auto=format&fit=crop'),
    ('PAR-PEU-208', 'Moldura Paragolpe Delantero Peugeot 208', 'Moldura cromada encaje original para paragolpes delantero, terminación brillante de fábrica.', 'Tazas y Molduras', 'Peugeot', '208', 2013, 2020, 28900.00, 6, 'https://images.unsplash.com/photo-1619767886558-efdc259cde1a?q=80&w=600&auto=format&fit=crop'),
    ('ALF-REN-01', 'Juego de Alfombras Goma PVC Negro x4', 'Juego universal de 4 piezas de goma PVC de alta resistencia con base antideslizante.', 'Volantes Deportivos y Accesorios', 'Renault', 'Todos', 2000, 2026, 22400.00, 20, 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?q=80&w=600&auto=format&fit=crop'),
    ('FUN-CUI-01', 'Funda Cubre Volante Cuero Ecológico Universal', 'Funda protectora de cuero ecológico microperforado para volantes estándar 37-39 cm.', 'Volantes Deportivos y Accesorios', 'Universal', 'Todos', 1990, 2026, 18500.00, 12, 'https://images.unsplash.com/photo-1611245789429-281b37803a67?q=80&w=600&auto=format&fit=crop'),
    ('OPT-HIL-16', 'Óptica Delantera Toyota Hilux 2016-2020', 'Óptica delantera derecha homologada, acrílico de alta transparencia y lúmenes reforzados.', 'Faros y Ópticas', 'Toyota', 'Hilux', 2016, 2020, 94000.00, 4, 'https://images.unsplash.com/photo-1606577924006-27d39b132ae2?q=80&w=600&auto=format&fit=crop'),
    ('ESP-GOL-12', 'Espejo Eléctrico Volkswagen Gol Trend', 'Espejo exterior eléctrico completo con carcasa lista para pintar, lado acompañante.', 'Espejos y Levantacristales', 'Volkswagen', 'Gol Trend', 2012, 2021, 38200.00, 6, 'https://images.unsplash.com/photo-1617469767053-d3b523a0b982?q=80&w=600&auto=format&fit=crop'),
    ('MAN-FIE-10', 'Manija Exterior Puerta delantera Ford Fiesta', 'Manija exterior de puerta delantera color negro texturado, repuesto original homologado.', 'Manijas y Cerraduras', 'Ford', 'Fiesta', 2010, 2019, 11500.00, 15, 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?q=80&w=600&auto=format&fit=crop'),
    ('VOL-DEP-01', 'Volante Deportivo Cuerina Confort', 'Volante deportivo universal tapizado en cuerina negra con centro reforzado de aluminio.', 'Volantes Deportivos y Accesorios', 'Universal', 'Todos', 1990, 2026, 49000.00, 8, 'https://images.unsplash.com/photo-1542282088-fe8426682b8f?q=80&w=600&auto=format&fit=crop'),
    ('FAR-208-20', 'Faro Trasero Peugeot 208 II 2020+', 'Faro trasero derecho acrílico con tecnología LED integrada, alta visibilidad nocturna.', 'Faros y Ópticas', 'Peugeot', '208', 2020, 2026, 78500.00, 3, 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?q=80&w=600&auto=format&fit=crop'),
    ('LEV-UNO-04', 'Kit Levantacristal Manual Fiat Uno 2p', 'Máquina levantacristal manual lado conductor para modelo 2 puertas, incluye manija rotativa.', 'Espejos y Levantacristales', 'Fiat', 'Uno', 2004, 2014, 24300.00, 9, 'https://images.unsplash.com/photo-1511919884226-fd3cad34687c?q=80&w=600&auto=format&fit=crop'),
    ('CER-CRU-16', 'Cerradura Portón Trasero Chevrolet Cruze', 'Cerradura eléctrica de baúl/portón trasero con sensor de apertura integrado, repuesto original.', 'Manijas y Cerraduras', 'Chevrolet', 'Cruze', 2016, 2025, 42900.00, 5, 'https://images.unsplash.com/photo-1553440569-bcc63803a83d?q=80&w=600&auto=format&fit=crop'),
    ('MAS-REN-08', 'Masa Adaptadora Volante Sandero / Logan', 'Masa de aluminio estriado universal para colocación de volantes deportivos en línea Renault.', 'Volantes Deportivos y Accesorios', 'Renault', 'Todos', 2008, 2026, 19800.00, 14, 'https://images.unsplash.com/photo-1502877338535-766e1452684a?q=80&w=600&auto=format&fit=crop'),
    ('MOL-COR-14', 'Moldura Paragolpe Delantero Toyota Corolla', 'Moldura embellecedora cromada delantera derecha para paragolpes, encaje a presión original.', 'Tazas y Molduras', 'Toyota', 'Corolla', 2014, 2024, 16200.00, 11, 'https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?q=80&w=600&auto=format&fit=crop'),
    ('OPT-AMA-10', 'Óptica Auxiliar Antiniebla Volkswagen Amarok', 'Faro auxiliar antiniebla delantero izquierdo, lente de vidrio y lámpara halógena incluida.', 'Faros y Ópticas', 'Volkswagen', 'Amarok', 2010, 2024, 31000.00, 7, 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?q=80&w=600&auto=format&fit=crop'),
    ('LEV-ONI-13', 'Levantacristal Eléctrico Chevrolet Onix/Prisma', 'Kit de máquina levantacristal eléctrica delantera derecha sin motor, repuesto certificado original.', 'Espejos y Levantacristales', 'Chevrolet', 'Onix', 2013, 2022, 49500.00, 5, 'https://images.unsplash.com/photo-1583121274602-3e2820c69888?q=80&w=600&auto=format&fit=crop'),
    ('CER-DUN-89', 'Juego de Cerraduras de Puerta Fiat Duna/Uno', 'Juego de 2 cilindros/tambores de cerradura con llaves idénticas para puertas izquierda y derecha.', 'Manijas y Cerraduras', 'Fiat', 'Uno', 1989, 2010, 13900.00, 20, 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?q=80&w=600&auto=format&fit=crop'),
    ('ALF-COR-14', 'Juego de Alfombras de Goma Pesada Toyota Corolla', 'Kit de 3 alfombras de goma virgen pesada antideslizante con logo bordado para habitáculo.', 'Volantes Deportivos y Accesorios', 'Toyota', 'Corolla', 2014, 2026, 36700.00, 9, 'https://images.unsplash.com/photo-1619767886558-efdc259cde1a?q=80&w=600&auto=format&fit=crop'),
    ('TAZ-13-MAT', 'Tazas Rodado 13 Deportivo Negro Mate', 'Juego de 4 tazas deportivas universales rodado 13, acabado color negro mate texturado premium.', 'Tazas y Molduras', 'Universal', 'Todos', 1990, 2026, 17200.00, 13, 'https://images.unsplash.com/photo-1502877338535-766e1452684a?q=80&w=600&auto=format&fit=crop')
) AS seed_data (code, name, description, category, brand, model, year_start, year_end, price, stock, image_url)
WHERE NOT EXISTS (SELECT 1 FROM public.products LIMIT 1);
