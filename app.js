import { supabase, fetchAllProducts } from "./supabase-client.js?v=2";
import { escapeHtml, normalizeName } from "./erp-logic.mjs?v=3";

// --- MAIN APPLICATION LOGIC ---
document.addEventListener("DOMContentLoaded", () => {
  // --- STATE MACHINE ---
  const STOREFRONT_PAGE_SIZE = 24;
  let products = []; // Populated dynamically from Supabase (paginated past 1,000 limit)
  let filteredProducts = [];
  let visibleCount = STOREFRONT_PAGE_SIZE;
  let cart = [];
  let selectedCategory = "Todos";
  let selectedBrand = "Todas";
  let selectedModel = "Todos";
  let selectedYear = "Todos";
  let searchQuery = "";
  let realtimeTimer = null;
  let searchDebounceTimer = null;

  // --- HTML ELEMENTS DOM REFERENCE ---
  const productGrid = document.getElementById("product-grid");
  const loadMoreWrapper = document.getElementById("load-more-wrapper");
  const loadMoreBtn = document.getElementById("load-more-btn");
  const currentCategoryTitle = document.getElementById("current-category-title");
  const resultsCount = document.getElementById("results-count");
  const searchInput = document.getElementById("search-input");
  const categoryList = document.getElementById("category-list");
  
  // Hierarchical Filters
  const brandFilter = document.getElementById("brand-filter");
  const modelFilter = document.getElementById("model-filter");
  const yearFilter = document.getElementById("year-filter");
  const resetFiltersBtn = document.getElementById("reset-filters-btn");
  
  // Shopping Cart & Drawer
  const cartDrawer = document.getElementById("cart-drawer");
  const cartItemsContainer = document.getElementById("cart-items");
  const cartSubtotalEl = document.getElementById("cart-subtotal");
  const cartGrandTotalEl = document.getElementById("cart-grand-total");
  const cartBadgeCountEl = document.getElementById("cart-badge-count");
  const checkoutBtn = document.getElementById("checkout-btn");
  const cartToggleBtn = document.getElementById("cart-toggle-btn");
  const clearCartBtn = document.getElementById("clear-cart-btn");

  // --- INITIALIZATION ---
  initApp();

  function initApp() {
    // 1. Load cart from LocalStorage
    try {
      const savedCart = localStorage.getItem("autocentro_cart");
      if (savedCart) {
        cart = JSON.parse(savedCart);
      }
    } catch (e) {
      console.error("Error cargando carrito desde localStorage:", e);
      cart = [];
    }

    // 2. Subscribe to Supabase catalog updates in real-time
    subscribeToCatalog();

    // 3. Bind interactive actions
    bindEventListeners();
    setupInvokersFallback();

    // 4. Adapt layout for mobile responsive order
    setupResponsiveLayout();
  }

  function setupResponsiveLayout() {
    const filterToggle = document.getElementById("mobile-filter-toggle");
    const sidebar = document.querySelector("aside.filter-sidebar");
    const mainContainer = document.getElementById("storefront");
    const productsDisplay = document.querySelector("section.products-display");
    if (!filterToggle || !sidebar || !mainContainer || !productsDisplay) return;

    const mq = window.matchMedia("(max-width: 992px)");
    const placeSidebar = (isCompact) => {
      if (isCompact) {
        if (sidebar.parentNode !== filterToggle.parentNode || sidebar.previousElementSibling !== filterToggle) {
          filterToggle.parentNode.insertBefore(sidebar, filterToggle.nextSibling);
        }
      } else {
        if (sidebar.parentNode !== mainContainer || sidebar.nextElementSibling !== productsDisplay) {
          mainContainer.insertBefore(sidebar, productsDisplay);
        }
      }
    };

    placeSidebar(mq.matches);
    mq.addEventListener("change", (e) => placeSidebar(e.matches));
  }

  function revealCatalog(shouldScroll = true) {
    const mainContainer = document.getElementById("storefront");
    if (mainContainer) {
      mainContainer.classList.add("revealed");
      if (shouldScroll) {
        setTimeout(() => {
          mainContainer.scrollIntoView({ behavior: "smooth" });
        }, 50);
      }
    }
  }

  // --- LOAD CATALOG & SUBSCRIBE TO REALTIME SUPABASE UPDATES ---
  async function loadCatalogFromSupabase() {
    try {
      products = await fetchAllProducts({ client: supabase });
    } catch (error) {
      console.error("Error al cargar catálogo de Supabase:", error);
      return;
    }

    populateBrandFilter();
    updateCategoryCounts();
    renderProducts();
    renderCart();
  }

  function scheduleCatalogRefresh() {
    clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(() => {
      loadCatalogFromSupabase();
    }, 2000);
  }

  function subscribeToCatalog() {
    loadCatalogFromSupabase();

    supabase
      .channel("public:products-storefront")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products" },
        () => {
          scheduleCatalogRefresh();
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.error("Error en la suscripción Realtime de Supabase para products.");
        }
      });
  }

  function bindEventListeners() {
    // 0. Immersive Welcoming CTAs Click Reveal Handler
    const viewCatalogBtn = document.querySelector(".intro-primary-btn");
    if (viewCatalogBtn) {
      viewCatalogBtn.addEventListener("click", (e) => {
        e.preventDefault();
        revealCatalog(true);
      });
    }

    if (cartToggleBtn) {
      cartToggleBtn.addEventListener("click", () => {
        revealCatalog(false); // silently reveal behind the overlay
      });
    }

    // Mobile Filters Toggle Button Click Handler
    const filterToggle = document.getElementById("mobile-filter-toggle");
    const sidebar = document.querySelector("aside.filter-sidebar");
    const filtersBar = document.querySelector(".store-filters-bar");
    
    if (filterToggle && sidebar && filtersBar) {
      filterToggle.addEventListener("click", () => {
        const isOpen = sidebar.classList.toggle("mobile-open");
        filtersBar.classList.toggle("mobile-open");
        filterToggle.classList.toggle("active");
        filterToggle.setAttribute("aria-expanded", isOpen);
      });
    }

    // A. Category Side-Menu Filtering
    categoryList.addEventListener("click", (e) => {
      const button = e.target.closest(".category-btn");
      if (!button) return;

      // Update active styling
      document.querySelectorAll(".category-btn").forEach(btn => btn.classList.remove("active"));
      button.classList.add("active");

      // Update state and render
      selectedCategory = button.dataset.category;
      currentCategoryTitle.textContent = selectedCategory === "Todos" ? "Todos los Productos" : selectedCategory;
      renderProducts();
    });

    // B. Footer Links Filtering
    document.querySelectorAll("[data-footer-category]").forEach(link => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const cat = link.dataset.footerCategory;
        
        revealCatalog(true); // Reveal the catalog with animation and scroll
        
        // Find matching sidebar button
        const sidebarBtn = document.querySelector(`.category-btn[data-category="${cat}"]`);
        if (sidebarBtn) {
          sidebarBtn.click();
        }
      });
    });

    // C. Debounced Keyword & SKU Search (accent-insensitive across 8k+ items)
    searchInput.addEventListener("input", (e) => {
      const val = normalizeName(e.target.value || "").trim();
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        searchQuery = val;
        if (searchQuery.length > 0) {
          revealCatalog(false); // Reveal silently without disturbing scroll focus
        }
        renderProducts();
      }, 150);
    });

    if (loadMoreBtn) {
      loadMoreBtn.addEventListener("click", () => {
        appendProductBatch();
      });
    }

    const searchForm = document.getElementById("search-form");
    if (searchForm) {
      searchForm.addEventListener("submit", (e) => {
        e.preventDefault();
        revealCatalog(true); // Reveal and scroll down on form submit
      });
    }

    // D. Hierarchical Select Filters Bindings
    brandFilter.addEventListener("change", (e) => {
      handleBrandChange(e.target.value);
    });

    modelFilter.addEventListener("change", (e) => {
      handleModelChange(e.target.value);
    });

    yearFilter.addEventListener("change", (e) => {
      selectedYear = e.target.value === "Todos" ? "Todos" : parseInt(e.target.value);
      renderProducts();
    });

    // E. WhatsApp Checkout Action (native link + guard when empty)
    checkoutBtn.addEventListener("click", (e) => {
      if (cart.length === 0) {
        e.preventDefault();
        return;
      }
      checkoutBtn.setAttribute("href", buildWhatsAppOrderUrl(cart));
    });

    // Light-dismiss cart dialog on backdrop click
    if (cartDrawer) {
      cartDrawer.addEventListener("click", (e) => {
        if (e.target === cartDrawer) {
          cartDrawer.close();
        }
      });
    }

    // F. Clear Cart Action
    clearCartBtn.addEventListener("click", () => {
      cart = [];
      saveCart();
      renderCart();
    });

    // G. Reset Filters Action
    resetFiltersBtn.addEventListener("click", () => {
      resetVehicleFilters();
    });
  }

  // --- HIERARCHICAL DYNAMIC FILTERS LOGIC ---
  
  // 1. Populate Brand selector on load
  function populateBrandFilter() {
    if (!brandFilter) return;
    
    // Preserve active selection if still available in new dataset
    const prevSelection = selectedBrand;
    brandFilter.innerHTML = '<option value="Todas">Todas las marcas</option>';
    
    // Extract unique car brands (excluding Universal)
    const brands = [...new Set(products
      .map(p => p.brand)
      .filter(brand => brand && brand !== "Universal"))]
      .sort();

    brands.forEach(brand => {
      const option = document.createElement("option");
      option.value = brand;
      option.textContent = brand;
      brandFilter.appendChild(option);
    });

    // Restore previous selection if valid
    if (brands.includes(prevSelection)) {
      brandFilter.value = prevSelection;
    } else {
      selectedBrand = "Todas";
    }
  }

  // 2. Handle Brand selection -> cascade to Models
  function handleBrandChange(brandVal) {
    selectedBrand = brandVal;
    selectedModel = "Todos";
    selectedYear = "Todos";
    
    // Reset secondary selectors DOM
    modelFilter.innerHTML = '<option value="Todos">Todos los modelos</option>';
    modelFilter.disabled = true;
    yearFilter.innerHTML = '<option value="Todos">Todos los años</option>';
    yearFilter.disabled = true;

    if (selectedBrand !== "Todas") {
      // Find models matching the selected brand
      const matchingModels = [...new Set(products
        .filter(p => p.brand === selectedBrand)
        .map(p => p.model))]
        .sort();

      // Populate Model selector
      matchingModels.forEach(model => {
        if (!model || model === "Todos") return;
        const opt = document.createElement("option");
        opt.value = model;
        opt.textContent = model;
        modelFilter.appendChild(opt);
      });

      // Enable model selector
      modelFilter.disabled = false;
    }

    renderProducts();
  }

  // 3. Handle Model selection -> cascade to Years
  function handleModelChange(modelVal) {
    selectedModel = modelVal;
    selectedYear = "Todos";

    // Reset Year selector DOM
    yearFilter.innerHTML = '<option value="Todos">Todos los años</option>';
    yearFilter.disabled = true;

    if (selectedModel !== "Todos") {
      // Find products matching the brand + model to extract the compatibility year range
      const matchingProducts = products.filter(p => p.brand === selectedBrand && p.model === selectedModel);
      
      if (matchingProducts.length > 0) {
        // Collect all compatible years from products ranges
        let compatibleYearsSet = new Set();
        
        matchingProducts.forEach(p => {
          const start = p.year_start || 2010;
          const end = p.year_end || 2026;
          for (let y = start; y <= end; y++) {
            compatibleYearsSet.add(y);
          }
        });

        // Convert, sort years descending (newest first)
        const sortedYears = [...compatibleYearsSet].sort((a, b) => b - a);

        // Populate Year selector
        sortedYears.forEach(year => {
          const opt = document.createElement("option");
          opt.value = year;
          opt.textContent = year.toString();
          yearFilter.appendChild(opt);
        });

        // Enable year selector
        yearFilter.disabled = false;
      }
    }

    renderProducts();
  }

  // 4. Reset all filters to default state
  function resetVehicleFilters() {
    selectedBrand = "Todas";
    selectedModel = "Todos";
    selectedYear = "Todos";

    brandFilter.value = "Todas";
    modelFilter.innerHTML = '<option value="Todos">Todos los modelos</option>';
    modelFilter.disabled = true;
    yearFilter.innerHTML = '<option value="Todos">Todos los años</option>';
    yearFilter.disabled = true;

    resetFiltersBtn.style.display = "none";
    renderProducts();
  }

  // --- INVOKER COMMANDS API FALLBACK ---
  // Bulletproof declarative fallback for older engines lacking Invokers support (Baseline 2025)
  function setupInvokersFallback() {
    const supportsInvokers = "commandForElement" in HTMLButtonElement.prototype;
    
    if (!supportsInvokers) {
      document.addEventListener("click", (event) => {
        const button = event.target.closest("button[commandfor]");
        if (!button) return;

        const targetId = button.getAttribute("commandfor");
        const command = button.getAttribute("command");
        const target = document.getElementById(targetId);

        if (target && target.tagName === "DIALOG") {
          if (command === "show-modal") {
            target.showModal();
          } else if (command === "close") {
            target.close();
          }
        }
      });
    }
  }

  // --- CURRENCY FORMATTER HELPER ---
  function formatARS(value) {
    return "$" + Number(value || 0).toLocaleString("es-AR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    });
  }

  // --- STATIC CATEGORY COUNT BADGES ---
  function updateCategoryCounts() {
    const counts = { Todos: products.length };
    
    products.forEach(p => {
      counts[p.category] = (counts[p.category] || 0) + 1;
    });

    const badgeMap = {
      "Todos": "count-Todos",
      "Faros y Ópticas": "count-Faros-Opticas",
      "Espejos y Levantacristales": "count-Espejos-Cristales",
      "Manijas y Cerraduras": "count-Manijas-Cerraduras",
      "Volantes Deportivos y Accesorios": "count-Volantes-Accesorios",
      "Tazas y Molduras": "count-Tazas-Molduras",
      "Otros Repuestos": "count-Otros-Repuestos"
    };

    Object.entries(badgeMap).forEach(([catKey, elId]) => {
      const el = document.getElementById(elId);
      if (el) {
        el.textContent = (counts[catKey] || 0).toLocaleString("es-AR");
      }
    });
  }

  function buildImagePlaceholderMarkup(category) {
    return `
      <div class="product-img-placeholder" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
        </svg>
        <span>${escapeHtml(category || "Repuesto Automotor")}</span>
      </div>
    `;
  }

  function createProductCard(p, index) {
    const card = document.createElement("article");
    card.className = "product-card";
    card.style.animationDelay = `${Math.min(index, 11) * 0.03}s`;

    const hasImageUrl = Boolean(p.image_url && p.image_url.trim());
    const mediaHtml = hasImageUrl
      ? `<img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.name)}" class="product-img" loading="lazy">`
      : buildImagePlaceholderMarkup(p.category);
    const codeHtml = p.code
      ? `<span class="product-code-tag">Cód. ${escapeHtml(p.code)}</span>`
      : "";

    card.innerHTML = `
      <div class="product-img-wrapper">
        <span class="category-tag">${escapeHtml(p.category)}</span>
        ${mediaHtml}
      </div>
      <div class="product-info">
        ${codeHtml}
        <h4 class="product-title">${escapeHtml(p.name)}</h4>
        <p class="product-description">${escapeHtml(p.description)}</p>
      </div>
      <div class="product-footer">
        <div class="price-stock-wrapper">
          <span class="product-price">${formatARS(p.price)}</span>
        </div>
        <div class="card-cart-slot" data-product-id="${escapeHtml(p.id)}"></div>
      </div>
    `;

    const imgEl = card.querySelector("img.product-img");
    if (imgEl) {
      imgEl.addEventListener("error", () => {
        imgEl.outerHTML = buildImagePlaceholderMarkup(p.category);
      }, { once: true });
    }

    renderCardCartSlot(card.querySelector(".card-cart-slot"), p);
    return card;
  }

  function updateStorefrontPaginationUI() {
    const total = filteredProducts.length;
    const shown = Math.min(visibleCount, total);
    resultsCount.textContent =
      total === 0
        ? "Mostrando 0 productos"
        : `Mostrando ${shown.toLocaleString("es-AR")} de ${total.toLocaleString("es-AR")} ${total === 1 ? "producto" : "productos"}`;

    if (loadMoreWrapper && loadMoreBtn) {
      const remaining = total - shown;
      if (remaining > 0) {
        loadMoreWrapper.style.display = "flex";
        const nextBatch = Math.min(STOREFRONT_PAGE_SIZE, remaining);
        loadMoreBtn.textContent = `Cargar ${nextBatch} más (${remaining.toLocaleString("es-AR")} restantes)`;
      } else {
        loadMoreWrapper.style.display = "none";
      }
    }
  }

  function appendProductBatch() {
    if (!productGrid) return;
    const prevEnd = Math.min(visibleCount, filteredProducts.length);
    visibleCount += STOREFRONT_PAGE_SIZE;
    const nextEnd = Math.min(visibleCount, filteredProducts.length);
    const fragment = document.createDocumentFragment();
    for (let i = prevEnd; i < nextEnd; i++) {
      fragment.appendChild(createProductCard(filteredProducts[i], i - prevEnd));
    }
    productGrid.appendChild(fragment);
    updateStorefrontPaginationUI();
  }

  // --- RENDER PRODUCTS GRID (Combined Hierarchical Cascading Filtering + Pagination) ---
  function renderProducts() {
    productGrid.innerHTML = "";
    visibleCount = STOREFRONT_PAGE_SIZE;

    // Toggle reset filters button visibility
    const hasActiveFilters = selectedBrand !== "Todas" || selectedModel !== "Todos" || selectedYear !== "Todos";
    if (resetFiltersBtn) {
      resetFiltersBtn.style.display = hasActiveFilters ? "inline-flex" : "none";
    }

    const searchTerms = searchQuery ? searchQuery.split(/\s+/).filter(Boolean) : [];

    // Apply combined filters: Category + Keyword/Code Search + Brand + Model + Year compatibility
    filteredProducts = products.filter(p => {
      const matchesCategory = selectedCategory === "Todos" || p.category === selectedCategory;
      if (!matchesCategory) return false;

      const matchesBrand = selectedBrand === "Todas" || p.brand === selectedBrand || p.brand === "Universal";
      if (!matchesBrand) return false;

      const matchesModel = selectedModel === "Todos" || p.model === selectedModel || p.model === "Todos" || p.brand === "Universal";
      if (!matchesModel) return false;

      const matchesYear = selectedYear === "Todos" ||
        (selectedYear >= p.year_start && selectedYear <= p.year_end) ||
        p.brand === "Universal";
      if (!matchesYear) return false;

      if (searchTerms.length === 0) return true;

      const searchable = normalizeName(
        `${p.code || ""} ${p.name || ""} ${p.description || ""} ${p.category || ""} ${p.brand || ""} ${p.model || ""}`
      );
      return searchTerms.every(term => searchable.includes(term));
    });

    if (filteredProducts.length === 0) {
      updateStorefrontPaginationUI();
      productGrid.innerHTML = `
        <div class="cart-empty-state" style="grid-column: 1 / -1; padding: var(--spacing-xl) var(--spacing-md);">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="inline-size: 56px; block-size: 56px; margin-block-end: 16px;">
            <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <p style="font-weight: 600; color: var(--text-primary);">No encontramos repuestos coincidentes</p>
          <p style="font-size: 0.85rem; color: var(--text-secondary); margin-block-start: 4px;">Probá modificando los filtros del vehículo, seleccionando otro año o cambiando la búsqueda.</p>
        </div>
      `;
      return;
    }

    const fragment = document.createDocumentFragment();
    const initialLimit = Math.min(visibleCount, filteredProducts.length);
    for (let i = 0; i < initialLimit; i++) {
      fragment.appendChild(createProductCard(filteredProducts[i], i));
    }
    productGrid.appendChild(fragment);
    updateStorefrontPaginationUI();
  }

  function renderCardCartSlot(slot, product) {
    if (!slot || !product) return;
    const cartItem = cart.find(item => String(item.product.id) === String(product.id));
    const qtyInCart = cartItem ? cartItem.quantity : 0;

    if (qtyInCart > 0) {
      slot.innerHTML = `
        <div class="card-qty-control" role="group" aria-label="Cantidad de ${escapeHtml(product.name)} en el carrito">
          <button type="button" class="card-qty-btn dec-btn" aria-label="Disminuir cantidad">−</button>
          <label class="card-qty-center">
            <input
              type="number"
              class="card-qty-input"
              min="0"
              max="${Number(product.stock) || 999}"
              value="${qtyInCart}"
              inputmode="numeric"
              aria-label="Cantidad en el carrito"
            >
            <span class="card-qty-label">en carrito</span>
          </label>
          <button type="button" class="card-qty-btn inc-btn" aria-label="Aumentar cantidad" ${qtyInCart >= product.stock ? "disabled" : ""}>+</button>
        </div>
      `;

      const decBtn = slot.querySelector(".dec-btn");
      const incBtn = slot.querySelector(".inc-btn");
      const qtyInput = slot.querySelector(".card-qty-input");

      decBtn.addEventListener("click", () => updateQuantity(product.id, -1));
      incBtn.addEventListener("click", () => updateQuantity(product.id, 1));
      qtyInput.addEventListener("change", (e) => {
        const parsed = parseInt(e.target.value, 10);
        if (Number.isNaN(parsed)) {
          e.target.value = String(qtyInCart);
          return;
        }
        setProductQuantity(product, parsed);
      });
      return;
    }

    if (Number(product.stock) <= 0) {
      slot.innerHTML = `
        <button type="button" class="add-to-cart-btn" disabled>
          <span>Sin stock</span>
        </button>
      `;
      return;
    }

    slot.innerHTML = `
      <button type="button" class="add-to-cart-btn" data-product-id="${escapeHtml(product.id)}">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        <span>Añadir al carrito</span>
      </button>
    `;

    slot.querySelector(".add-to-cart-btn").addEventListener("click", () => {
      addToCart(product);
    });
  }

  function syncProductCardsActions() {
    if (!productGrid) return;
    const slots = productGrid.querySelectorAll(".card-cart-slot[data-product-id]");
    slots.forEach((slot) => {
      const pid = slot.getAttribute("data-product-id");
      const product = products.find(p => String(p.id) === String(pid))
        || (cart.find(item => String(item.product.id) === String(pid)) || {}).product;
      if (product) {
        renderCardCartSlot(slot, product);
      }
    });
  }

  // --- CART QUANTITY HELPERS ---
  function applyCartQuantity(product, nextQty, { showAddedToast = false } = {}) {
    if (!product) return;

    if (nextQty <= 0) {
      removeFromCart(product.id);
      return;
    }

    const maxStock = Number(product.stock) || 0;
    if (nextQty > maxStock) {
      showToast(`Stock máximo disponible para ${product.name}: ${maxStock}`);
      nextQty = maxStock;
      if (nextQty <= 0) return;
    }

    const existing = cart.find(item => String(item.product.id) === String(product.id));
    if (existing) {
      existing.product = product;
      existing.quantity = nextQty;
    } else {
      cart.push({ product, quantity: nextQty });
    }

    saveCart();
    renderCart();
    animateCartBadge();

    if (showAddedToast) {
      showToast(`¡Añadido al pedido: ${product.name}!`);
    }
  }

  function addToCart(product) {
    const existing = cart.find(item => String(item.product.id) === String(product.id));
    const nextQty = existing ? existing.quantity + 1 : 1;
    applyCartQuantity(product, nextQty, { showAddedToast: !existing });
  }

  function updateQuantity(productId, change) {
    const item = cart.find(i => String(i.product.id) === String(productId));
    if (!item) return;
    applyCartQuantity(item.product, item.quantity + change);
  }

  function setProductQuantity(product, nextQty) {
    applyCartQuantity(product, nextQty);
  }

  function removeFromCart(productId) {
    cart = cart.filter(item => String(item.product.id) !== String(productId));
    saveCart();
    renderCart();
  }

  function saveCart() {
    try {
      localStorage.setItem("autocentro_cart", JSON.stringify(cart));
    } catch (e) {
      console.error("Error guardando carrito en localStorage:", e);
    }
  }

  // --- CART ANIMATION INTERACTION ---
  function animateCartBadge() {
    cartToggleBtn.classList.remove("bounce");
    void cartToggleBtn.offsetWidth; // trigger reflow
    cartToggleBtn.classList.add("bounce");
  }

  // --- TOAST NOTIFICATIONS SYSTEM ---
  function showToast(message) {
    const container = document.getElementById("toast-container");
    if (!container) return;

    // Clear existing notifications to avoid visual clutter
    const activeToasts = container.querySelectorAll(".toast-notification");
    activeToasts.forEach(t => {
      t.classList.add("hide");
      setTimeout(() => t.remove(), 300);
    });

    const toast = document.createElement("div");
    toast.className = "toast-notification";
    toast.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="#25D366" style="inline-size: 18px; block-size: 18px; flex-shrink: 0;">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
      <span>${escapeHtml(message)}</span>
      <button class="toast-action-btn" id="toast-action">Ver pedido</button>
    `;

    toast.querySelector("#toast-action").addEventListener("click", () => {
      cartDrawer.showModal();
      toast.classList.add("hide");
      setTimeout(() => toast.remove(), 300);
    });

    container.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) {
        toast.classList.add("hide");
        setTimeout(() => toast.remove(), 300);
      }
    }, 3500);
  }

  // --- RENDER CART DRAWER CONTENTS ---
  function renderCart() {
    cartItemsContainer.innerHTML = "";
    syncProductCardsActions();
    
    let subtotal = 0;
    let totalItems = 0;

    if (cart.length === 0) {
      clearCartBtn.style.display = "none";
      cartItemsContainer.innerHTML = `
        <div class="cart-empty-state">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007ZM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
          </svg>
          <p style="font-weight: 600;">El carrito está vacío</p>
          <p style="font-size: 0.8rem; margin-block-start: 4px;">¡Agregá productos de la tienda para empezar tu pedido!</p>
        </div>
      `;
      
      cartSubtotalEl.textContent = "$0";
      cartGrandTotalEl.textContent = "$0";
      cartBadgeCountEl.textContent = "0";
      checkoutBtn.setAttribute("href", "https://wa.me/5493416055274");
      checkoutBtn.setAttribute("aria-disabled", "true");
      checkoutBtn.classList.add("is-disabled");
      return;
    }

    cart.forEach(item => {
      const itemCost = item.product.price * item.quantity;
      subtotal += itemCost;
      totalItems += item.quantity;

      const itemRow = document.createElement("div");
      itemRow.className = "cart-item";
      itemRow.innerHTML = `
        <img src="${escapeHtml(item.product.image_url)}" alt="${escapeHtml(item.product.name)}" class="cart-item-img">
        <div class="cart-item-details">
          <span class="cart-item-name">${escapeHtml(item.product.name)}</span>
          <span class="cart-item-price">${formatARS(item.product.price)} c/u</span>
          
          <div class="cart-item-actions">
            <!-- Quantity selectors -->
            <div class="quantity-selector">
              <button class="qty-btn dec-btn" aria-label="Disminuir cantidad">-</button>
              <span class="qty-val">${item.quantity}</span>
              <button class="qty-btn inc-btn" aria-label="Aumentar cantidad">+</button>
            </div>
            <!-- Remove link -->
            <button class="remove-item-btn" aria-label="Eliminar producto del pedido">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="inline-size: 12px; block-size: 12px;">
                <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
              </svg>
              <span>Eliminar</span>
            </button>
          </div>
        </div>
      `;

      // Quantities bindings
      itemRow.querySelector(".dec-btn").addEventListener("click", () => updateQuantity(item.product.id, -1));
      itemRow.querySelector(".inc-btn").addEventListener("click", () => updateQuantity(item.product.id, 1));
      itemRow.querySelector(".remove-item-btn").addEventListener("click", () => removeFromCart(item.product.id));

      cartItemsContainer.appendChild(itemRow);
    });

    // Update totals and badge count
    cartSubtotalEl.textContent = formatARS(subtotal);
    cartGrandTotalEl.textContent = formatARS(subtotal);
    cartBadgeCountEl.textContent = totalItems;
    checkoutBtn.setAttribute("href", buildWhatsAppOrderUrl(cart));
    checkoutBtn.removeAttribute("aria-disabled");
    checkoutBtn.classList.remove("is-disabled");
    clearCartBtn.style.display = "inline-flex";
  }

  // --- WHATSAPP INTEGRATION SERIALIZATION FLOW ---
  function buildWhatsAppOrderUrl(cartItems) {
    const whatsappNum = "5493416055274";
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return `https://wa.me/${whatsappNum}`;
    }

    let message = "Hola Accesorios Autocentro S.R.L.! Me gustaría realizar el siguiente pedido:\n\n";

    let subtotal = 0;
    cartItems.forEach((item) => {
      const itemCost = item.product.price * item.quantity;
      subtotal += itemCost;
      message += `• *${item.quantity}x* ${item.product.name} (_${formatARS(item.product.price)} c/u_)\n`;
    });

    message += `\n*Total del Pedido: ${formatARS(subtotal)}*\n\n`;
    message += "¿Tienen disponibilidad para retirar por el local de *Corrientes 579, S2000 Rosario, Santa Fe*?";

    const encodedText = encodeURIComponent(message);
    return `https://wa.me/${whatsappNum}?text=${encodedText}`;
  }
});
