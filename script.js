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
const API_BASE_URL = (
  window.ECOFI_API_BASE_URL ||
  localStorage.getItem("ecofi_api_base_url") ||
  "http://localhost:4000"
).replace(/\/+$/, "");

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

  const buildProductsUrl = (includeQuery = true) => {
    const url = new URL(apiUrl("/api/products"));
    if (includeQuery && searchTerm) url.searchParams.append("q", searchTerm);
    // Global text search should not be restricted by current category filters.
    if (!hasSearchTerm && effectiveCategory) url.searchParams.append("category", effectiveCategory);
    if (!hasSearchTerm && effectiveSubCategory) url.searchParams.append("subCategory", effectiveSubCategory);
    if (!hasSearchTerm && effectiveL3Category) url.searchParams.append("l3Category", effectiveL3Category);
    if (sort) url.searchParams.append("sort", sort);
    return url;
  };

  // Set the page title
  if (hasSearchTerm) {
    searchPageTitle.textContent = `Search results for "${searchTerm}"`;
  } else if (effectiveL3Category) {
    searchPageTitle.textContent = effectiveL3Category;
  } else if (effectiveSubCategory) {
    searchPageTitle.textContent = effectiveSubCategory;
  } else if (effectiveCategory) { 
    searchPageTitle.textContent = effectiveCategory;
  } else {
    searchPageTitle.textContent = "All Sustainable Products";
  }

  try {
    const res = await fetch(buildProductsUrl(true));
    if (!res.ok) throw new Error('Failed to fetch products');
    
    const data = await res.json();
    let products = data.products || [];

    // If a query returns nothing, fallback to non-query listing so the catalog remains usable.
    if (searchTerm && products.length === 0) {
      const fallbackRes = await fetch(buildProductsUrl(false));
      if (fallbackRes.ok) {
        const fallbackData = await fallbackRes.json();
        products = fallbackData.products || [];
        if (products.length > 0) {
          showToast("No exact match found. Showing available products.");
        }
      }
    }

    renderProducts(products, 'results');
  } catch (err) {
    console.error(err);
    document.getElementById('results').innerHTML = '<p>Could not load products.</p>';
  }
}

function renderProducts(products, targetId = 'results') {
  const targetGrid = document.getElementById(targetId);
  if (!targetGrid) return;
  
  if (!products || products.length === 0) {
    targetGrid.innerHTML = '<p>No products found for this category.</p>';
    return;
  }

  targetGrid.innerHTML = products.map(product => {
    const shortDescription = (product.description && product.description.length > 100)
      ? product.description.substring(0, 100) + '...'
      : product.description || 'No description available.';

    const isFavorite = currentUserWishlist.has(product._id);
    const heartIcon = isFavorite ? '❤️' : '♡';
    const favoriteClass = isFavorite ? 'is-favorite' : '';

    return `
      <div class="product-card">
        <a href="${product.productUrl}" target="_blank" rel="noopener noreferrer" class="product-card-link-image">
          <img src="${product.imageUrl || 'images/logo-main.png'}" alt="${product.title}">
        </a>
        <div>
          <h3>
            <a href="${product.productUrl}" target="_blank" rel="noopener noreferrer" class="product-card-link-title">
              ${product.title}
            </a>
          </h3>
          <p>${shortDescription}</p>
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
      else if (["about", "contact", "faq", "settings"].includes(event.state.page)) {
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
    fetchAndRenderProducts(); 
    showPage('search');
  });
  document.getElementById('headerSearch').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      fetchAndRenderProducts();
      showPage('search');
    }
  });
  
  document.getElementById('sortSelect').addEventListener('change', () => {
    fetchAndRenderProducts();
  });
  
  document.getElementById("quickSearchBtn")?.addEventListener("click", () => {
    clearSearchFilters(); 
    fetchAndRenderProducts(); 
    showPage("search");
  });
  
  document.querySelector(".categories-section-homepage")?.addEventListener("click", (e) => {
    const card = e.target.closest(".category-card-homepage");
    if (!card) return;
    
    e.preventDefault();
    const category = card.dataset.category;
    
    if (category) {
      fetchAndRenderProducts(category); 
      showPage("search"); 
    }
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
});
