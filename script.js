/* -------------------------------
   ECOFI FRONTEND SCRIPT (v3)
   - Secure auth
   - Product search & filtering
   - Working dark mode
   ------------------------------- */

// Helper: Show toast messages
function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => {
    toast.classList.remove("show");
  }, 2500);
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

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("active", link.dataset.target === pageId);
  });

  if (!isBackNavigation) {
    const currentHash = window.location.hash.substring(1);
    if (currentHash !== pageId) {
      history.pushState({ page: pageId }, null, `#${pageId}`);
    }
  }
}

// -------------------------------
//  Dark Mode Logic
// -------------------------------

/**
 * Applies the dark mode theme and updates UI elements.
 * @param {boolean} isDark - True to enable dark mode, false for light mode.
 */
function applyDarkMode(isDark) {
  const toggle = document.getElementById('darkModeToggle');
  const icon = document.getElementById('darkModeBtn');

  if (isDark) {
    document.body.classList.add('dark');
    if (toggle) toggle.checked = true;
    if (icon) icon.textContent = '☀️'; // Sun icon
    localStorage.setItem('ecofi_theme', 'dark');
  } else {
    document.body.classList.remove('dark');
    if (toggle) toggle.checked = false;
    if (icon) icon.textContent = '🌙'; // Moon icon
    localStorage.setItem('ecofi_theme', 'light');
  }
}

// -------------------------------
//  Authentication Logic
// -------------------------------

// Sign Up
async function signUp(name, email, password, confirm) {
  if (!name || !email || !password || !confirm) {
    showToast("Please fill in all fields");
    return;
  }
  if (password !== confirm) {
    showToast("Passwords do not match");
    return;
  }

  try {
    const res = await fetch("http://localhost:4000/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Signup failed");

    // Save token/user from signup response
    localStorage.setItem("token", data.token);
    localStorage.setItem("ecofi_user_v1", JSON.stringify(data.user));
    showToast("Account created successfully! Welcome.");
    updateAuthUI();
    showPage("home");
  } catch (err) {
    showToast(err.message);
  }
}

// Sign In
async function signIn(email, password) {
  if (!email || !password) {
    showToast("Please fill in all fields");
    return;
  }

  try {
    const res = await fetch("http://localhost:4000/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Login failed");

    localStorage.setItem("token", data.token);
    localStorage.setItem("ecofi_user_v1", JSON.stringify(data.user));
    showToast("Welcome back!");
    updateAuthUI();
    showPage("home");
  } catch (err) {
    showToast(err.message);
  }
}

// Load Profile from Backend
async function loadProfile() {
  const token = localStorage.getItem("token");
  if (!token) {
    showToast("Please log in first");
    showPage("auth");
    return;
  }

  try {
    const res = await fetch("http://localhost:4000/api/profile", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Could not load profile");

    document.getElementById("profileName").textContent = data.user.name;
    document.getElementById("profileEmailDisplay").textContent = data.user.email;
    document.getElementById("profileJoinDate").textContent = new Date(
      data.user.joinDate
    ).toDateString();

    showPage("profile");
  } catch (err) {
    showToast(err.message);
    // If token is bad, log them out
    if (err.message.includes("Invalid token") || err.message.includes("Access denied")) {
      logout();
    }
  }
}

// Logout
function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("ecofi_user_v1");
  showToast("Logged out successfully");
  updateAuthUI();
  showPage("home");
}

// -------------------------------
//  Product & Search Logic
// -------------------------------

/**
 * Fetches products from the backend based on current filters and search term.
 */
async function fetchAndRenderProducts() {
  const searchTerm = document.getElementById('headerSearch').value;
  const category = document.getElementById('categoryFilter').value;
  const sort = document.getElementById('sortSelect').value;

  const url = new URL('http://localhost:4000/api/products');
  if (searchTerm) url.searchParams.append('q', searchTerm);
  if (category) url.searchParams.append('category', category);
  if (sort) url.searchParams.append('sort', sort);

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch products');
    
    const data = await res.json();
    renderProducts(data.products);
  } catch (err) {
    console.error(err);
    showToast(err.message);
    document.getElementById('results').innerHTML = '<p>Could not load products.</p>';
  }
}

/**
 * Renders an array of product objects into the results grid.
 */
function renderProducts(products) {
  const resultsGrid = document.getElementById('results');
  
  if (products.length === 0) {
    resultsGrid.innerHTML = '<p>No products found matching your criteria.</p>';
    return;
  }

  resultsGrid.innerHTML = products.map(product => `
    <div class="product-card">
      <img src="${product.imageUrl || 'images/logo-main.png'}" alt="${product.title}">
      <div>
        <h3>${product.title}</h3>
        <p>${product.description}</p>
        <div class="card-row">
          <div>
            <button class="btn fav-btn" data-id="${product.id}">Favorite</button>
            <button class="btn details-btn" data-id="${product.id}">Details</button>
          </div>
          <div>$${product.price.toFixed(2)}</div>
        </div>
      </div>
    </div>
  `).join('');
}

/**
 * Fetches categories and populates the filter dropdown.
 */
async function loadCategories() {
  try {
    const res = await fetch('http://localhost:4000/api/categories');
    if (!res.ok) throw new Error('Failed to load categories');

    const categories = await res.json();
    const categoryFilter = document.getElementById('categoryFilter');
    
    // Clear existing options first (except "All categories")
    categoryFilter.innerHTML = '<option value="">All categories</option>'; 
    
    categories.forEach(category => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      categoryFilter.appendChild(option);
    });
  } catch (err) {
    console.error(err);
    showToast(err.message);
  }
}

// -------------------------------
//  UI & Event Handlers
// -------------------------------

// Update nav bar buttons depending on login state
function updateAuthUI() {
  const user = JSON.parse(localStorage.getItem("ecofi_user_v1"));
  const authNavBtn = document.getElementById("authNavBtn");
  const profileNavBtn = document.getElementById("profileNavBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const userGreeting = document.getElementById("userGreeting");

  if (user) {
    authNavBtn.style.display = "none";
    profileNavBtn.style.display = "block";
    logoutBtn.style.display = "block";
    userGreeting.textContent = `Hi, ${user.name.split(" ")[0]}`;
  } else {
    authNavBtn.style.display = "block";
    profileNavBtn.style.display = "none";
    logoutBtn.style.display = "none";
    userGreeting.textContent = "";
  }
}

// -------------------------------
//  Event Bindings
// -------------------------------

document.addEventListener("DOMContentLoaded", () => {
  // --- Set initial theme ---
  const savedTheme = localStorage.getItem('ecofi_theme') === 'dark';
  applyDarkMode(savedTheme);

  // --- Set initial auth state ---
  updateAuthUI();

  // --- Load initial product/category data ---
  loadCategories();
  fetchAndRenderProducts(); // Load all products on page load

  // --- Handle Initial Page Load from URL Hash ---
  const initialPage = window.location.hash.substring(1) || "home";
  if (initialPage === "profile") {
    loadProfile();
  } else {
    showPage(initialPage, true);
  }

  // --- Handle Browser Back/Forward Navigation ---
  window.addEventListener("popstate", (event) => {
    if (event.state && event.state.page) {
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

  // --- Main Page Navigation ---
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      const pageId = link.dataset.target;
      if (pageId === "profile") {
        loadProfile();
      } else if (pageId) {
        showPage(pageId);
      }
    });
  });

  // --- Logout Buttons ---
  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("logoutBtnProfile").addEventListener("click", logout);

  // --- Search & Filter Event Listeners ---
  const headerSearchBtn = document.getElementById('headerSearchBtn');
  const headerSearchInput = document.getElementById('headerSearch');
  const categoryFilter = document.getElementById('categoryFilter');
  const sortSelect = document.getElementById('sortSelect');

  headerSearchBtn.addEventListener('click', () => {
    fetchAndRenderProducts();
    showPage('search');
  });

  headerSearchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      fetchAndRenderProducts();
      showPage('search');
    }
  });

  categoryFilter.addEventListener('change', fetchAndRenderProducts);
  sortSelect.addEventListener('change', fetchAndRenderProducts);
  
  // --- Other UI Buttons ---
  document
    .getElementById("quickSearchBtn")
    ?.addEventListener("click", () => showPage("search"));

  // --- Dark Mode Listeners ---
  document.getElementById('darkModeBtn').addEventListener('click', () => {
    const isCurrentlyDark = document.body.classList.contains('dark');
    applyDarkMode(!isCurrentlyDark);
  });

  document.getElementById('darkModeToggle').addEventListener('click', (e) => {
    applyDarkMode(e.target.checked);
  });

});