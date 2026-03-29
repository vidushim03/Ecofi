/* -------------------------------
   ECOFI FRONTEND SCRIPT (v6.2)
   - Added settings sidebar logic.
   ------------------------------- */

let currentUserWishlist = new Set();
let currentSearchFilters = {
  category: null,
  subCategory: null,
  l3Category: null,
};
const FILTERS_KEY = "ecofi_current_filters";
const RECENT_SEARCHES_KEY = "ecofi_recent_searches";
const ADMIN_KEY_STORAGE = "ecofi_admin_key";
const API_BASE_URL = (
  window.ECOFI_API_BASE_URL ||
  localStorage.getItem("ecofi_api_base_url") ||
  "http://localhost:4000"
).replace(/\/+$/, "");
const searchState = {
  page: 1,
  pageSize: 12,
  lastMeta: null,
  lastQuery: "",
};

function apiUrl(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

// Helper: Show toast messages
function showToast(message, isError = false) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.toggle("error", isError); // You might want to add a .error class in CSS
  toast.classList.add("show");
  setTimeout(() => {
    toast.classList.remove("show");
    toast.classList.toggle("error", false);
  }, 2500);
}

// Helper: Validate email format
function isValidEmail(email) {
  const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return re.test(String(email).toLowerCase());
}

function clearSearchFilters() {
  currentSearchFilters.category = null;
  currentSearchFilters.subCategory = null;
  currentSearchFilters.l3Category = null;
  
  const headerSearch = document.getElementById('headerSearch');
  if (headerSearch) {
    headerSearch.value = "";
  }
  sessionStorage.removeItem(FILTERS_KEY);
}

function getRecentSearches() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY)) || [];
  } catch (err) {
    return [];
  }
}

function saveRecentSearch(query) {
  const normalized = query.trim();
  if (!normalized) return;
  const nextSearches = [normalized, ...getRecentSearches().filter((item) => item !== normalized)].slice(0, 6);
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(nextSearches));
}

function renderRecentSearches() {
  const container = document.getElementById("recentSearches");
  if (!container) return;
  const searches = getRecentSearches();
  if (searches.length === 0) {
    container.innerHTML = '<span class="search-summary">No recent searches yet.</span>';
    return;
  }
  container.innerHTML = searches
    .map(
      (query) =>
        `<button class="search-chip" type="button" data-query="${query.replace(/"/g, "&quot;")}">${query}</button>`
    )
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function highlightText(text, query) {
  const safeText = escapeHtml(text || "");
  const normalizedQuery = (query || "").trim();
  if (!normalizedQuery) return safeText;
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean).map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (tokens.length === 0) return safeText;
  const regex = new RegExp(`(${tokens.join("|")})`, "gi");
  return safeText.replace(regex, '<mark class="search-highlight">$1</mark>');
}

function renderResultsState(message = "", stateClass = "") {
  const stateNode = document.getElementById("resultsState");
  if (!stateNode) return;
  stateNode.className = `results-state${stateClass ? ` ${stateClass}` : ""}`;
  stateNode.textContent = message;
}

function renderLoadingSkeleton() {
  const targetGrid = document.getElementById("results");
  if (!targetGrid) return;
  targetGrid.innerHTML = `
    <div class="results-skeleton">
      ${Array.from({ length: searchState.pageSize }).map(
        () => `
          <div class="skeleton-card">
            <div class="skeleton-block skeleton-image"></div>
            <div class="skeleton-content">
              <div class="skeleton-block skeleton-line"></div>
              <div class="skeleton-block skeleton-line"></div>
              <div class="skeleton-block skeleton-line short"></div>
            </div>
          </div>
        `
      ).join("")}
    </div>
  `;
}

function renderPagination(meta) {
  const container = document.getElementById("paginationControls");
  if (!container) return;
  if (!meta || meta.totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  const pageButtons = [];
  const startPage = Math.max(1, meta.page - 2);
  const endPage = Math.min(meta.totalPages, meta.page + 2);
  for (let page = startPage; page <= endPage; page += 1) {
    pageButtons.push(`
      <button class="pagination-btn${page === meta.page ? " active" : ""}" type="button" data-page="${page}">
        ${page}
      </button>
    `);
  }

  container.innerHTML = `
    <button class="pagination-btn" type="button" data-page="${meta.page - 1}" ${meta.page === 1 ? "disabled" : ""}>Prev</button>
    ${pageButtons.join("")}
    <button class="pagination-btn" type="button" data-page="${meta.page + 1}" ${meta.page === meta.totalPages ? "disabled" : ""}>Next</button>
  `;
}

// Helper: Switch visible page
function showPage(pageId, isBackNavigation = false) {
  document.querySelectorAll(".page").forEach((p) => {
    p.classList.remove("active");
    p.setAttribute("aria-hidden", "true");
  });

  const targetPage = document.getElementById(pageId);
  if (targetPage) {
    targetPage.classList.add("active");
    targetPage.setAttribute("aria-hidden", "false");
  } else {
    document.getElementById("home").classList.add("active");
    pageId = "home";
  }

  // De-activate all main category links
  document.querySelectorAll(".top-nav .nav-link").forEach((link) => {
    link.classList.remove("active");
  });
  
  const activeLink = document.querySelector(`.nav-link[data-target="${pageId}"]`);
  if (activeLink) {
    activeLink.classList.add("active");
  }

  if (!isBackNavigation) {
    const currentHash = window.location.hash.substring(1);
    if (currentHash !== pageId) {
      history.pushState({ page: pageId }, null, `#${pageId}`);
    }
  }
  // Scroll to top when changing page
  window.scrollTo(0, 0);
}

// -------------------------------
//  Dark Mode Logic
// -------------------------------

function applyDarkMode(isDark) {
  // const toggle = document.getElementById('darkModeToggle'); // Toggle is removed
  
  if (isDark) {
    document.body.classList.add('dark');
    // if (toggle) toggle.checked = true; // Toggle is removed
    localStorage.setItem('ecofi_theme', 'dark');
  } else {
    document.body.classList.remove('dark');
    // if (toggle) toggle.checked = false; // Toggle is removed
    localStorage.setItem('ecofi_theme', 'light');
  }
}

// -------------------------------
//  Authentication Logic
// -------------------------------

async function fetchUserWishlist(token) {
  if (!token) {
    currentUserWishlist.clear();
    return;
  }
  try {
    const res = await fetch(apiUrl("/api/wishlist"), {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await res.json();
    if (res.ok && data.products) {
      currentUserWishlist = new Set(data.products.map(p => p._id));
    } else {
      currentUserWishlist.clear();
    }
  } catch (err) {
    console.error("Could not fetch user wishlist:", err);
    currentUserWishlist.clear();
  }
}

async function signUp(name, email, password, confirm) {
  if (!name || !email || !password || !confirm) {
    showToast("Please fill in all fields", true);
    return;
  }
  if (!isValidEmail(email)) {
    showToast("Please enter a valid email address", true);
    return;
  }
  if (password.length < 6) {
    showToast("Password must be at least 6 characters long", true);
    return;
  }
  if (password !== confirm) {
    showToast("Passwords do not match", true);
    return;
  }

  try {
    const res = await fetch(apiUrl("/api/signup"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Signup failed");

    localStorage.setItem("token", data.token);
    localStorage.setItem("ecofi_user_v1", JSON.stringify(data.user));
    
    currentUserWishlist.clear();

    showToast("Account created successfully! Welcome.");
    await updateAuthUI(); // Wait for UI to update
    showPage("home");
  } catch (err) {
    const errorMessage = err.message.toLowerCase();
    if (errorMessage.includes("email already") || errorMessage.includes("user already exists")) {
      showToast("This email is already registered. Please sign in.", true);
    } else {
      showToast(err.message, true);
    }
  }
}

async function signIn(email, password) {
  if (!email || !password) {
    showToast("Please fill in all fields", true);
    return;
  }
  if (!isValidEmail(email)) {
    showToast("Please enter a valid email address", true);
    return;
  }

  try {
    const res = await fetch(apiUrl("/api/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Login failed");

    localStorage.setItem("token", data.token);
    localStorage.setItem("ecofi_user_v1", JSON.stringify(data.user));
    
    await fetchUserWishlist(data.token);

    showToast("Welcome back!");
    await updateAuthUI(); // Wait for UI to update
    showPage("home");
    
    fetchAndRenderProducts(); 

  } catch (err) {
    const errorMessage = err.message.toLowerCase();
    if (errorMessage.includes("user not found")) {
      showToast("User not existing. Please sign up.", true);
    } else if (errorMessage.includes("incorrect password")) {
      showToast("Incorrect password. Please try again.", true);
    } else {
      showToast(err.message, true);
    }
  }
}

async function loadProfile() {
  const token = localStorage.getItem("token");
  if (!token) {
    showToast("Please log in first", true);
    showPage("auth");
    return;
  }

  try {
    const res = await fetch(apiUrl("/api/profile"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Could not load profile");

    // Populate display fields
    document.getElementById("profileName").textContent = data.user.name;
    document.getElementById("profileEmailDisplay").textContent = data.user.email;
    document.getElementById("profileJoinDate").textContent = new Date(
      data.user.joinDate
    ).toDateString();
    
    // Also populate the settings form (in case user navigates there)
    document.getElementById("updateNameInput").value = data.user.name;

    showPage("profile");
  } catch (err) {
    showToast(err.message, true);
    if (err.message.includes("Invalid token") || err.message.includes("Expired token") || err.message.includes("Access denied")) {
      logout();
    }
  }
}

async function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("ecofi_user_v1");
  
  currentUserWishlist.clear();

  showToast("Logged out successfully");
  await updateAuthUI(); // Wait for UI to update
  showPage("home");
  
  fetchAndRenderProducts(); 
}

// -------------------------------
//  Wishlist Logic
// -------------------------------

async function toggleFavorite(productId, buttonElement) {
  const token = localStorage.getItem("token");
  if (!token) {
    showToast("Please log in to add to wishlist", true);
    showPage("auth");
    return;
  }

  try {
    const res = await fetch(apiUrl("/api/wishlist/toggle"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ productId: productId }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Failed to update wishlist");
    
    showToast(data.message);

    if (data.action === "added") {
      buttonElement.innerHTML = '❤️';
      buttonElement.classList.add('is-favorite');
      currentUserWishlist.add(productId);
    } else if (data.action === "removed") {
      buttonElement.innerHTML = '♡';
      buttonElement.classList.remove('is-favorite');
      currentUserWishlist.delete(productId);

      const wishlistPage = document.getElementById('wishlist');
      if (wishlistPage.classList.contains('active')) {
        buttonElement.closest('.product-card').remove();
      }
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

async function loadWishlistPage() {
  const token = localStorage.getItem("token");
  if (!token) {
    showToast("Please log in to view your wishlist", true);
    showPage("auth");
    return;
  }
  
  const wishlistContainer = document.getElementById('wishlistList'); 
  if (!wishlistContainer) return;
  wishlistContainer.innerHTML = "<p>Loading your wishlist...</p>";

  try {
    const res = await fetch(apiUrl("/api/wishlist"), {
      headers: { "Authorization": `Bearer ${token}` }
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Failed to load wishlist");

    currentUserWishlist = new Set(data.products.map(p => p._id));

    renderProducts(data.products, 'wishlistList');
  } catch (err) {
    wishlistContainer.innerHTML = `<p>${err.message}</p>`;
    showToast(err.message, true);
  }
}

// -------------------------------
//  Product & Search Logic
// -------------------------------

async function fetchAndRenderProducts(category, subCategory, l3Category) {
  let effectiveCategory, effectiveSubCategory, effectiveL3Category;

  if (category !== undefined || subCategory !== undefined || l3Category !== undefined) {
    effectiveCategory = category;
    effectiveSubCategory = subCategory;
    effectiveL3Category = l3Category;

    currentSearchFilters.category = category;
    currentSearchFilters.subCategory = subCategory;
    currentSearchFilters.l3Category = l3Category;
    
    sessionStorage.setItem(FILTERS_KEY, JSON.stringify(currentSearchFilters));
    
  } else {
    effectiveCategory = currentSearchFilters.category;
    effectiveSubCategory = currentSearchFilters.subCategory;
    effectiveL3Category = currentSearchFilters.l3Category;
  }
  
  const searchTerm = document.getElementById('headerSearch').value.trim();
  const hasSearchTerm = searchTerm.length > 0;
  const sort = document.getElementById('sortSelect').value;
  const searchPageTitle = document.getElementById('searchPageTitle');
  const searchSummary = document.getElementById("searchSummary");
  searchState.lastQuery = searchTerm;

  const buildProductsUrl = (includeQuery = true) => {
    const url = new URL(apiUrl("/api/products"));
    if (includeQuery && searchTerm) url.searchParams.append("q", searchTerm);
    // Global text search should not be restricted by current category filters.
    if (!hasSearchTerm && effectiveCategory) url.searchParams.append("category", effectiveCategory);
    if (!hasSearchTerm && effectiveSubCategory) url.searchParams.append("subCategory", effectiveSubCategory);
    if (!hasSearchTerm && effectiveL3Category) url.searchParams.append("l3Category", effectiveL3Category);
    if (sort) url.searchParams.append("sort", sort);
    url.searchParams.append("page", String(searchState.page));
    url.searchParams.append("pageSize", String(searchState.pageSize));
    return url;
  };

  // Set the page title
  if (hasSearchTerm) {
    searchPageTitle.textContent = `Search results for "${searchTerm}"`;
    if (searchSummary) searchSummary.textContent = "Global search is active, so category filters are ignored while you type.";
  } else if (effectiveL3Category) {
    searchPageTitle.textContent = effectiveL3Category;
    if (searchSummary) searchSummary.textContent = "Browsing a focused category slice from the EcoFi catalog.";
  } else if (effectiveSubCategory) {
    searchPageTitle.textContent = effectiveSubCategory;
    if (searchSummary) searchSummary.textContent = "Browsing a focused category slice from the EcoFi catalog.";
  } else if (effectiveCategory) { 
    searchPageTitle.textContent = effectiveCategory;
    if (searchSummary) searchSummary.textContent = "Browsing a focused category slice from the EcoFi catalog.";
  } else {
    searchPageTitle.textContent = "All Sustainable Products";
    if (searchSummary) searchSummary.textContent = "Browse the catalog, or type a query to search globally.";
  }

  try {
    renderResultsState("Loading products...", "loading");
    renderLoadingSkeleton();
    const res = await fetch(buildProductsUrl(true));
    if (!res.ok) throw new Error('Failed to fetch products');
    
    const data = await res.json();
    if (hasSearchTerm) {
      saveRecentSearch(searchTerm);
      renderRecentSearches();
    }
    searchState.lastMeta = data.meta || null;
    renderProducts(data.products || [], 'results');
    renderPagination(data.meta || null);
    if (data.meta) {
      renderResultsState(
        `${data.meta.total} result${data.meta.total === 1 ? "" : "s"} • Page ${data.meta.page} of ${data.meta.totalPages}${data.meta.searchSource ? ` • ${data.meta.searchSource}` : ""}`
      );
    } else {
      renderResultsState("");
    }
  } catch (err) {
    console.error(err);
    renderResultsState("Could not load products right now.", "error");
    document.getElementById('results').innerHTML = '<div class="empty-state"><h3>Search unavailable</h3><p>Try again in a moment or adjust your filters.</p></div>';
    renderPagination(null);
  }
}

function renderProducts(products, targetId = 'results') {
  const targetGrid = document.getElementById(targetId);
  if (!targetGrid) return;
  
  if (!products || products.length === 0) {
    if (targetId === "wishlistList") {
      targetGrid.innerHTML = '<div class="empty-state"><h3>Your wishlist is empty</h3><p>Save products you love and they will show up here.</p></div>';
    } else {
      const emptyTitle = searchState.lastQuery
        ? `No results for "${searchState.lastQuery}"`
        : "No products found";
      const emptyBody = searchState.lastQuery
        ? "Try a broader term, use one of the popular chips, or clear the search to browse the catalog."
        : "Try another category or check back after more products are added.";
      targetGrid.innerHTML = `<div class="empty-state"><h3>${escapeHtml(emptyTitle)}</h3><p>${escapeHtml(emptyBody)}</p></div>`;
    }
    return;
  }

  targetGrid.innerHTML = products.map(product => {
    const shortDescription = (product.description && product.description.length > 100)
      ? product.description.substring(0, 100) + '...'
      : product.description || 'No description available.';

    const isFavorite = currentUserWishlist.has(product._id);
    const heartIcon = isFavorite ? '❤️' : '♡';
    const favoriteClass = isFavorite ? 'is-favorite' : '';
    const matchSource = product.matchMeta && product.matchMeta.source
      ? `<span class="match-badge">${escapeHtml(product.matchMeta.source)}</span>`
      : '';

    return `
      <div class="product-card">
        <a href="${product.productUrl}" target="_blank" rel="noopener noreferrer" class="product-card-link-image">
          <img src="${product.imageUrl || 'images/logo-main.png'}" alt="${product.title}">
        </a>
        <div>
          <div class="product-card-meta">${matchSource}</div>
          <h3>
            <a href="${product.productUrl}" target="_blank" rel="noopener noreferrer" class="product-card-link-title">
              ${highlightText(product.title, targetId === "results" ? searchState.lastQuery : "")}
            </a>
          </h3>
          <p>${highlightText(shortDescription, targetId === "results" ? searchState.lastQuery : "")}</p>
          <div class="card-row">
            <div>
              <button class="btn fav-btn ${favoriteClass}" data-id="${product._id}" aria-label="Add to wishlist">${heartIcon}</button>
            </div>
            <div>₹${product.price.toFixed(2)}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// -------------------------------
//  UI & Event Handlers
// -------------------------------

async function updateAuthUI() {
  const user = JSON.parse(localStorage.getItem("ecofi_user_v1"));
  
  const signInLink = document.getElementById('userDropdownSignIn');
  const profileLink = document.getElementById('userDropdownProfile');
  const wishlistLink = document.getElementById('userDropdownWishlist');
  const settingsLink = document.getElementById('userDropdownSettings');
  const logoutLink = document.getElementById('userDropdownLogout');
  const userGreeting = document.getElementById("userGreeting");

  if (user) {
    if (profileLink) profileLink.style.display = 'block';
    if (wishlistLink) wishlistLink.style.display = 'block';
    if (settingsLink) settingsLink.style.display = 'block';
    if (logoutLink) logoutLink.style.display = 'block';
    if (userGreeting) userGreeting.textContent = `Profile`;
    if (signInLink) signInLink.style.display = 'none';

    await fetchUserWishlist(localStorage.getItem("token"));
  } else {
    if (profileLink) profileLink.style.display = 'none';
    if (wishlistLink) wishlistLink.style.display = 'none';
    if (settingsLink) settingsLink.style.display = 'none';
    if (logoutLink) logoutLink.style.display = 'none';
    if (signInLink) signInLink.style.display = 'block';

    currentUserWishlist.clear();
  }
}

// -------------------------------
//  Event Bindings
// -------------------------------

document.addEventListener("DOMContentLoaded", async () => {
  // --- Set initial theme ---
  const savedTheme = localStorage.getItem('ecofi_theme') === 'dark';
  applyDarkMode(savedTheme);

  // --- Await the UI update so wishlist is loaded ---
  await updateAuthUI();

  const savedFilters = sessionStorage.getItem(FILTERS_KEY);
  if (savedFilters) {
    currentSearchFilters = JSON.parse(savedFilters);
  } else {
    clearSearchFilters();
  }
  renderRecentSearches();
  const pageSizeSelect = document.getElementById("pageSizeSelect");
  if (pageSizeSelect) {
    searchState.pageSize = Number.parseInt(pageSizeSelect.value, 10) || 12;
  }
  
  fetchAndRenderProducts(); // Load products based on saved (or cleared) filters

  // --- Handle Initial Page Load from URL Hash ---
  const initialPage = window.location.hash.substring(1) || "home";
  if (initialPage === "profile") {
    loadProfile();
  } else if (initialPage === "wishlist") {
    loadWishlistPage();
    showPage("wishlist", true); 
  } else {
    showPage(initialPage, true);
  }

  // --- Handle Browser Back/Forward Navigation ---
  window.addEventListener("popstate", (event) => {
    if (event.state && event.state.page) {
      if (event.state.page === "profile") loadProfile();
      else if (event.state.page === "wishlist") loadWishlistPage();
      else if (event.state.page === "search") fetchAndRenderProducts();
      else if (["about", "contact", "faq", "settings", "admin"].includes(event.state.page)) {
         showPage(event.state.page, true);
      }
      showPage(event.state.page, true);
    } else {
      showPage("home", true);
    }
  });

  // --- Auth Form Bindings ---
  document.getElementById("signinForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("signinEmail").value.trim();
    const password = document.getElementById("signinPassword").value;
    await signIn(email, password);
    e.target.reset();
  });
  document.getElementById("signupForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("signupName").value.trim();
    const email = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;
    const confirm = document.getElementById("signupConfirm").value;
    await signUp(name, email, password, confirm);
    e.target.reset();
  });

  // --- Auth Tab Switching ---
  document.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const targetForm = tab.dataset.tab;
      document.querySelectorAll(".auth-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      document.querySelectorAll(".auth-form").forEach((form) => {
        form.classList.toggle("active", form.dataset.form === targetForm);
      });
    });
  });

  // --- Main Page Navigation (Category + User Dropdown) ---
  
  document.querySelector(".logo-link").addEventListener("click", () => {
    showPage("home");
  });

  const userMenuContainer = document.querySelector(".user-menu-container");
  const userMenuBtn = document.getElementById("userMenuBtn");
  if (userMenuContainer && userMenuBtn) {
    userMenuBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      userMenuContainer.classList.toggle("open");
    });

    document.addEventListener("click", (e) => {
      if (!userMenuContainer.contains(e.target)) {
        userMenuContainer.classList.remove("open");
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        userMenuContainer.classList.remove("open");
      }
    });

    userMenuContainer.addEventListener("click", (e) => {
      if (e.target.closest(".dropdown-link")) {
        userMenuContainer.classList.remove("open");
      }
    });
  }
  
  document.querySelector(".top-nav").addEventListener("click", (e) => {
    e.preventDefault();
    const target = e.target.closest(".dropdown-link, .dropdown-heading"); 
    if (!target) return;

    const category = target.dataset.category;
    const subCategory = target.dataset.subcategory;
    const l3Category = target.dataset.l3category;
    
    searchState.page = 1;
    fetchAndRenderProducts(category, subCategory, l3Category);
    showPage("search");
  });

  document.getElementById("userDropdownSignIn")?.addEventListener("click", (e) => {
    e.preventDefault();
    showPage("auth");
  });
  document.getElementById("userDropdownProfile")?.addEventListener("click", (e) => {
    e.preventDefault();
    loadProfile();
  });
  document.getElementById("userDropdownWishlist")?.addEventListener("click", (e) => {
    e.preventDefault();
    loadWishlistPage();
    showPage("wishlist");
  });
  document.getElementById("userDropdownSettings")?.addEventListener("click", (e) => {
    e.preventDefault();
    // Pre-fill name input when settings page is opened
    const user = JSON.parse(localStorage.getItem("ecofi_user_v1"));
    if (user) {
      document.getElementById("updateNameInput").value = user.name;
    }
    
    // --- NEW: Reset settings page to default tab ---
    document.querySelectorAll(".settings-nav-link").forEach(link => {
      link.classList.toggle("active", link.dataset.target === "settings-profile");
    });
    document.querySelectorAll(".settings-subpage").forEach(page => {
      page.classList.toggle("active", page.id === "settings-profile");
    });
    // --- End of new logic ---
    
    showPage("settings");
  });
  document.getElementById("userDropdownAdmin")?.addEventListener("click", (e) => {
    e.preventDefault();
    showPage("admin");
  });
  document.getElementById("userDropdownLogout")?.addEventListener("click", (e) => {
    e.preventDefault();
    logout();
  });
  
  document.querySelector(".site-footer")?.addEventListener("click", (e) => {
    e.preventDefault();
    const target = e.target.closest(".footer-link");
    if (!target) return;

    const page = target.dataset.target;
    if (page === "home") {
      showPage("home");
    } else if (page === "search") {
      clearSearchFilters(); 
      fetchAndRenderProducts(); 
      showPage("search");
    } else if (page === "wishlist") {
      loadWishlistPage();
      showPage("wishlist");
    } else if (["about", "contact", "faq"].includes(page)) {
      showPage(page);
    }
  });

  // --- Logout Button (from profile page) ---
  document.getElementById("logoutBtnProfile").addEventListener("click", logout);

  // --- Search Bar ---
  document.getElementById('headerSearchBtn').addEventListener('click', () => {
    searchState.page = 1;
    fetchAndRenderProducts(); 
    showPage('search');
  });
  document.getElementById('headerSearch').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      searchState.page = 1;
      fetchAndRenderProducts();
      showPage('search');
    }
  });
  
  document.getElementById('sortSelect').addEventListener('change', () => {
    searchState.page = 1;
    fetchAndRenderProducts();
  });
  document.getElementById("pageSizeSelect")?.addEventListener("change", (e) => {
    searchState.pageSize = Number.parseInt(e.target.value, 10) || 12;
    searchState.page = 1;
    fetchAndRenderProducts();
  });
  
  document.getElementById("quickSearchBtn")?.addEventListener("click", () => {
    clearSearchFilters(); 
    searchState.page = 1;
    fetchAndRenderProducts(); 
    showPage("search");
  });
  
  document.querySelector(".categories-section-homepage")?.addEventListener("click", (e) => {
    const card = e.target.closest(".category-card-homepage");
    if (!card) return;
    
    e.preventDefault();
    const category = card.dataset.category;
    
    if (category) {
      searchState.page = 1;
      fetchAndRenderProducts(category); 
      showPage("search"); 
    }
  });
  document.querySelector(".search-discovery")?.addEventListener("click", (e) => {
    const chip = e.target.closest(".search-chip");
    if (!chip) return;
    e.preventDefault();
    const query = chip.dataset.query;
    if (!query) return;
    document.getElementById("headerSearch").value = query;
    searchState.page = 1;
    fetchAndRenderProducts();
    showPage("search");
  });
  document.getElementById("paginationControls")?.addEventListener("click", (e) => {
    const button = e.target.closest(".pagination-btn");
    if (!button || button.disabled) return;
    const nextPage = Number.parseInt(button.dataset.page, 10);
    if (!Number.isFinite(nextPage) || nextPage < 1) return;
    searchState.page = nextPage;
    fetchAndRenderProducts();
    showPage("search");
  });

  // --- Event Listener for Favorite Buttons (Heart) ---
  document.querySelector(".main-content").addEventListener("click", (e) => {
    const favButton = e.target.closest(".fav-btn");
    if (favButton) {
      e.preventDefault();
      e.stopPropagation();
      const productId = favButton.dataset.id;
      if (productId) {
        toggleFavorite(productId, favButton);
      }
    }
  });
  
  // ========================================================================
  // NEW/UPDATED: PROFILE & STATIC PAGE EVENT LISTENERS
  // ========================================================================

  // --- NEW: Settings Sidebar Navigation ---
  document.querySelector(".settings-sidebar")?.addEventListener("click", (e) => {
    e.preventDefault();
    const targetLink = e.target.closest(".settings-nav-link");
    
    if (!targetLink) return; // Didn't click a link
    
    const targetPageId = targetLink.dataset.target;
    
    // Update links
    document.querySelectorAll(".settings-nav-link").forEach(link => {
      link.classList.remove("active");
    });
    targetLink.classList.add("active");
    
    // Update content
    document.querySelectorAll(".settings-subpage").forEach(page => {
      page.classList.remove("active");
    });
    document.getElementById(targetPageId)?.classList.add("active");
  });
  document.querySelector(".admin-sidebar")?.addEventListener("click", (e) => {
    e.preventDefault();
    const targetLink = e.target.closest(".admin-nav-link");
    if (!targetLink) return;
    document.querySelectorAll(".admin-nav-link").forEach((link) => {
      link.classList.remove("active");
    });
    targetLink.classList.add("active");
    document.querySelectorAll("#admin .settings-subpage").forEach((page) => {
      page.classList.remove("active");
    });
    document.getElementById(targetLink.dataset.target)?.classList.add("active");
  });

  // --- Contact Form ---
  document.getElementById("contactForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    showToast("Message sent! (Demo)");
    e.target.reset();
  });

  // --- Update Name Form ---
  document.getElementById("updateNameForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const newName = document.getElementById("updateNameInput").value.trim();
    const token = localStorage.getItem("token");

    if (!newName) {
      showToast("Name cannot be empty", true);
      return;
    }
    if (!token) {
      showToast("Please log in again", true);
      logout();
      return;
    }

    try {
      const res = await fetch(apiUrl("/api/profile/details"), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ name: newName }),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to update name");

      // Update local storage
      const localUser = JSON.parse(localStorage.getItem("ecofi_user_v1"));
      if (localUser) {
        localUser.name = data.user.name;
        localStorage.setItem("ecofi_user_v1", JSON.stringify(localUser));
      }
      
      // Update the UI (on the profile page, if it's ever loaded again)
      document.getElementById("profileName").textContent = data.user.name;
      
      showToast("Name updated successfully!");

    } catch (err) {
      showToast(err.message, true);
    }
  });

  // --- Change Password Form ---
  document.getElementById("changePasswordForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById("currentPassword").value;
    const newPassword = document.getElementById("newPassword").value;
    const confirmNewPassword = document.getElementById("confirmNewPassword").value;
    const token = localStorage.getItem("token");

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      showToast("Please fill in all password fields", true);
      return;
    }
    if (newPassword.length < 6) {
      showToast("New password must be at least 6 characters", true);
      return;
    }
    if (newPassword !== confirmNewPassword) {
      showToast("New passwords do not match", true);
      return;
    }
    if (!token) {
      showToast("Please log in again", true);
      logout();
      return;
    }
    
    try {
      const res = await fetch(apiUrl("/api/auth/change-password"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to change password");

      showToast("Password changed successfully!");
      e.target.reset(); // Clear the form

    } catch (err) {
      showToast(err.message, true);
    }
  });
  
  // --- Delete Account Button ---
  document.getElementById("deleteAccountBtn")?.addEventListener("click", async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      showToast("Please log in again", true);
      logout();
      return;
    }

    if (!confirm("Are you absolutely sure?\nThis action cannot be undone and your account and wishlist will be permanently deleted.")) {
      return;
    }

    try {
      const res = await fetch(apiUrl("/api/profile"), {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` },
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to delete account");
      
      showToast("Account deleted successfully. Goodbye.");
      logout(); // Log the user out and redirect to home

    } catch (err) {
      showToast(err.message, true);
    }
  });

  const syncAdminKeys = (value) => {
    ["adminKeyInput", "adminBulkKeyInput", "adminRemoveKeyInput"].forEach((id) => {
      const input = document.getElementById(id);
      if (input && input.value !== value) {
        input.value = value;
      }
    });
  };
  const savedAdminKey = localStorage.getItem(ADMIN_KEY_STORAGE) || "";
  syncAdminKeys(savedAdminKey);
  ["adminKeyInput", "adminBulkKeyInput", "adminRemoveKeyInput"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", (e) => {
      localStorage.setItem(ADMIN_KEY_STORAGE, e.target.value);
      syncAdminKeys(e.target.value);
    });
  });

  document.getElementById("adminAddProductForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ecoReasons = document.getElementById("adminEcoReasons").value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const payload = {
      adminKey: document.getElementById("adminKeyInput").value,
      source: document.getElementById("adminSource").value,
      productId: document.getElementById("adminProductId").value.trim(),
      category: document.getElementById("adminCategory").value.trim(),
      subCategory: document.getElementById("adminSubCategory").value.trim(),
      l3Category: document.getElementById("adminL3Category").value.trim(),
      ecoScore: document.getElementById("adminEcoScore").value,
      ecoReasons,
    };

    try {
      const res = await fetch(apiUrl("/api/admin/addproduct"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to add product");
      showToast(data.message || "Product added successfully");
      e.target.reset();
      syncAdminKeys(localStorage.getItem(ADMIN_KEY_STORAGE) || "");
      fetchAndRenderProducts();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById("adminBulkImportForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const products = JSON.parse(document.getElementById("adminBulkPayload").value);
      const res = await fetch(apiUrl("/api/admin/add-bulk"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminKey: document.getElementById("adminBulkKeyInput").value,
          products,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Bulk import failed");
      showToast(data.message || "Bulk import complete");
      fetchAndRenderProducts();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById("adminRemoveProductsForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const filters = {};
    [["category", "adminRemoveCategory"], ["subCategory", "adminRemoveSubCategory"], ["source", "adminRemoveSource"], ["l3Category", "adminRemoveL3Category"]]
      .forEach(([key, id]) => {
        const value = document.getElementById(id).value.trim();
        if (value) filters[key] = value;
      });
    if (Object.keys(filters).length === 0) {
      showToast("Add at least one filter before removing products.", true);
      return;
    }
    try {
      const res = await fetch(apiUrl("/api/admin/remove-products"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminKey: document.getElementById("adminRemoveKeyInput").value,
          filters,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to remove products");
      showToast(`${data.deletedCount} products removed.`);
      fetchAndRenderProducts();
    } catch (err) {
      showToast(err.message, true);
    }
  });
});
