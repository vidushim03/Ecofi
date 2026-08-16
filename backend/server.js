console.log("✅ RUNNING THE SERVER.JS FILE ✅");

const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const dotenv = require("dotenv");
const { User } = require("./models/User.js");
const { Product } = require("./models/Product.js");
const axios = require("axios");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const compression = require("compression");
const cookieParser = require("cookie-parser");

dotenv.config();

const app = express();
const corsOrigins = (process.env.CORS_ORIGIN || "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = corsOrigins.includes("*")
  ? {}
  : {
      origin: corsOrigins,
    };

app.use(cors({ ...corsOptions, credentials: true }));
app.use(compression());
app.use(cookieParser());
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "base-uri": ["'self'"],
        "font-src": ["'self'", "https:", "data:"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'self'"],
        "img-src": ["'self'", "https:", "data:"],
        "object-src": ["'none'"],
        "script-src": ["'self'"],
        "script-src-attr": ["'none'"],
        "style-src": ["'self'", "https:", "'unsafe-inline'"],
        "upgrade-insecure-requests": [],
      },
    },
  })
);
app.use(express.json({ limit: "1mb" }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/signup", authLimiter);
app.use("/api/login", authLimiter);
app.use("/api/auth/change-password", authLimiter);
app.use("/api/admin", adminLimiter);

const FRONTEND_DIR = path.join(__dirname, "..");
const PUBLIC_FILES = new Set(["/", "/index.html", "/style.css", "/script.js"]);

app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const p = decodeURIComponent(req.path);
  if (PUBLIC_FILES.has(p) || p.startsWith("/images/")) {
    if (p === "/") req.url = "/index.html";
    return express.static(FRONTEND_DIR, { dotfiles: "deny" })(req, res, next);
  }
  next();
});

async function backfillPriceHistory() {
  try {
    const result = await Product.updateMany(
      {
        price: { $exists: true, $ne: null },
        $or: [
          { priceHistory: { $exists: false } },
          { priceHistory: { $size: 0 } },
        ],
      },
      [
        {
          $set: {
            priceHistory: [
              {
                price: "$price",
                date: {
                  $ifNull: ["$lastPriceUpdated", "$$NOW"],
                },
              },
            ],
          },
        },
      ]
    );
    if (result.modifiedCount > 0) {
      console.log(`[Backfill] Seeded price history for ${result.modifiedCount} products.`);
    }
  } catch (err) {
       console.error("[Backfill] Failed to seed price history:", err.message);
    }
  }

  async function backfillSource() {
    try {
      const missing = await Product.find({
        $or: [{ source: { $exists: false } }, { source: "" }],
      }).select("_id productUrl").lean();
      let count = 0, skipped = 0;
      for (const doc of missing) {
        const inferred = inferSourceFromUrl(doc.productUrl);
        if (!inferred) { skipped++; continue; }
        try {
          const r = await Product.updateOne(
            { _id: doc._id },
            { $set: { source: inferred } }
          );
          if (r.modifiedCount > 0) count++;
        } catch (err) {
          skipped++;
        }
      }
      console.log(`[Backfill] Inferred source for ${count} products (${skipped} skipped).`);
    } catch (err) {
      console.error("[Backfill] Failed to infer source:", err.message);
    }
  }

  function extractProductIdFromUrl(source, productUrl) {
    try {
      if (!productUrl) return null;
      if (source === "amazon-in" || source === "amazon-com") {
        const m = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/.exec(productUrl);
        return m ? m[1] : null;
      }
      if (source === "flipkart") {
        const u = new URL(productUrl);
        const seg = u.pathname.split("/").filter(Boolean);
        const idx = seg.indexOf("p");
        if (idx >= 0 && seg[idx + 1]) {
          const m = /^([A-Za-z0-9_-]+)$/.exec(seg[idx + 1]);
          if (m) return m[1];
        }
        return seg[0] || null;
      }
      if (source === "myntra") {
        const m = /\/([A-Za-z0-9_-]+)\.html$/.exec(productUrl);
        return m ? m[1] : null;
      }
    } catch {
      return null;
    }
    return null;
  }

  async function backfillProductId() {
    try {
      const missing = await Product.find({
        $or: [{ productId: { $exists: false } }, { productId: "" }],
      }).select("_id source productUrl").lean();
      let count = 0;
      for (const doc of missing) {
        const pid = extractProductIdFromUrl(doc.source, doc.productUrl);
        if (pid) {
          const r = await Product.updateOne(
            { _id: doc._id },
            { $set: { productId: pid } }
          );
          if (r.modifiedCount > 0) count++;
        }
      }
      console.log(`[Backfill] Extracted productId for ${count} products.`);
    } catch (err) {
      console.error("[Backfill] Failed to extract productId:", err.message);
    }
  }

  async function connectToMongo(retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 30000,
        connectTimeoutMS: 30000,
        socketTimeoutMS: 45000,
        maxPoolSize: 10,
      });
      console.log("✅ MongoDB connected");
      backfillPriceHistory();
      backfillSource();
      backfillProductId();
      return;
    } catch (err) {
      console.error(
        `❌ MongoDB connection attempt ${attempt}/${retries} failed: ${err.message}`
      );
      if (attempt === retries) {
        console.error("❌ Could not connect to MongoDB. Exiting.");
        process.exit(1);
      }
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  }
}

connectToMongo();

app.get("/", (req, res) => res.send("EcoFi backend running 🚀"));

const protect = async (req, res, next) => {
  let token;
  const auth = req.headers.authorization;
  const cookieToken = req.cookies && req.cookies.token;

  if (cookieToken) {
    token = cookieToken;
  } else if (auth && auth.startsWith("Bearer")) {
    token = auth.split(" ")[1];
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      req.user = await User.findById(decoded.id).select("-password");

      if (!req.user) {
        return res.status(401).json({ message: "User not found" });
      }
      next();
      return;
    } catch (err) {
      let message = "Not authorized";
      if (err.name === "JsonWebTokenError") message = "Invalid token";
      if (err.name === "TokenExpiredError") message = "Expired token";
      return res.status(401).json({ message });
    }
  }

  return res.status(401).json({ message: "Not authorized, no token" });
};

function setAuthCookie(res, token) {
  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === "production",
  });
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// =================================================================
// Authentication Routes
// =================================================================
app.post("/api/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: "All fields required" });
    if (!EMAIL_REGEX.test(String(email).trim())) {
      return res.status(400).json({ message: "Please provide a valid email" });
    }
    if (password.length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters" });
    }
    const existing = await User.findOne({ email });
    if (existing)
      return res.status(400).json({ message: "Email already registered" });
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashed });
    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );
    setAuthCookie(res, token);
    res.json({
      message: "Account created successfully",
      token,
      user: { name: user.name, email: user.email, joinDate: user.joinDate },
    });
  } catch (err) {
    console.error("Error in /api/signup:", err.message);
    res.status(500).json({ message: "Server error during signup" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(400).json({ message: "Incorrect password" });
    }
    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );
    setAuthCookie(res, token);
    res.json({
      message: "Login successful",
      token,
      user: { name: user.name, email: user.email, joinDate: user.joinDate },
    });
  } catch (err) {
    console.error("Error in /api/login:", err.message);
    res.status(500).json({ message: "Server error during login" });
  }
});

app.post("/api/auth/change-password", protect, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: "Please provide all fields" });
  }

  if (newPassword.length < 6) {
    return res
      .status(400)
      .json({ message: "Password must be at least 6 characters" });
  }

  const user = req.user;

  const fullUser = await User.findById(user._id);

  const match = await bcrypt.compare(currentPassword, fullUser.password);
  if (!match) {
    return res.status(401).json({ message: "Incorrect current password" });
  }

  const hashed = await bcrypt.hash(newPassword, 10);

  fullUser.password = hashed;
  await fullUser.save();

  res.json({ message: "Password updated successfully" });
});

// =================================================================
// Profile Routes
// =================================================================

app.get("/api/profile", protect, async (req, res) => {
  res.json({ user: req.user });
});

app.patch("/api/profile/details", protect, async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ message: "Name is required" });
  }

  try {
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { name: name },
      { new: true }
    ).select("-password");

    res.json({ message: "Profile updated", user: updatedUser });
  } catch (err) {
    console.error("Error updating profile:", err.message);
    res.status(500).json({ message: "Error updating profile" });
  }
});

app.delete("/api/profile", protect, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.user._id);

    res.json({ message: "Account deleted successfully" });
  } catch (err) {
    console.error("Error deleting account:", err.message);
    res.status(500).json({ message: "Error deleting account" });
  }
});

// =================================================================
// EMBEDDING HELPER FUNCTION
// =================================================================
const MODEL_API_URL = "https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2";
const failedSearchCounts = new Map();
const embeddingCache = new Map();
const EMBEDDING_CACHE_LIMIT = 200;

function cachedEmbedding(text) {
  const key = String(text || "").toLowerCase().trim();
  if (!key) return null;
  return embeddingCache.get(key) || null;
}

function storeEmbedding(text, vector) {
  const key = String(text || "").toLowerCase().trim();
  if (!key) return;
  embeddingCache.set(key, vector);
  if (embeddingCache.size > EMBEDDING_CACHE_LIMIT) {
    const oldestKey = embeddingCache.keys().next().value;
    embeddingCache.delete(oldestKey);
  }
}

function trackFailedSearch(query) {
  const key = String(query || "").toLowerCase().trim();
  if (!key) return;
  failedSearchCounts.set(key, (failedSearchCounts.get(key) || 0) + 1);
}

function logTopFailedSearches(limit = 5) {
  const entries = Array.from(failedSearchCounts.entries());
  if (entries.length === 0) return;
  const top = entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([query, count]) => `${query}:${count}`)
    .join(", ");
  console.log(`[Search][Analytics] Top failed queries -> ${top}`);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getExpandedQueries(rawQuery) {
  const normalized = String(rawQuery || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const aliasMap = {
    copy: ["notebook", "notebooks", "copybook", "exercise book", "spiral notebook", "stationery"],
    copies: ["notebook", "notebooks", "copybook", "exercise book", "spiral notebook", "stationery"],
    notebook: ["copy", "copies", "copybook", "exercise book", "stationery"],
    notebooks: ["copy", "copies", "copybook", "exercise book", "stationery"],
    "t shirt": ["t-shirt", "tshirt", "tee", "top"],
    "t-shirt": ["t shirt", "tshirt", "tee", "top"],
    tshirt: ["t shirt", "t-shirt", "tee", "top"],
    tee: ["t shirt", "t-shirt", "tshirt", "top"],
    shirt: ["top", "t shirt", "t-shirt", "tshirt"],
    top: ["shirt", "t shirt", "t-shirt", "tshirt"],
    shoes: ["shoe", "footwear", "sneakers", "boots", "sandals", "flats"],
    shoe: ["shoes", "footwear", "sneakers", "boots", "sandals", "flats"],
    sneaker: ["sneakers", "shoes", "footwear"],
    sneakers: ["sneaker", "shoes", "footwear"],
    bottle: ["bottles", "sipper", "flask", "container", "storage"],
    bottles: ["bottle", "sipper", "flask", "container", "storage"],
    sipper: ["bottle", "flask"],
    flask: ["bottle", "sipper"],
    jar: ["container", "storage"],
    jars: ["container", "storage"],
    container: ["containers", "jar", "box", "storage"],
    containers: ["container", "jar", "box", "storage"],
    planter: ["planters", "pot", "pots", "garden"],
    planters: ["planter", "pot", "pots", "garden"],
    pot: ["pots", "planter", "garden"],
    pots: ["pot", "planter", "garden"],
    soap: ["bodywash", "personal care", "cleanser"],
    shampoo: ["hair care", "cleanser"],
    toothbrush: ["dental care", "brush"],
    diaper: ["diapers", "baby", "cloth diapers"],
    diapers: ["diaper", "baby", "cloth diapers"],
    toys: ["toy", "kids", "play"],
    toy: ["toys", "kids", "play"],
    gift: ["gifts", "gift box", "kit"],
    gifts: ["gift", "gift box", "kit"],
  };

  const expanded = new Set([normalized]);
  if (aliasMap[normalized]) {
    for (const alt of aliasMap[normalized]) expanded.add(alt);
  }
  return Array.from(expanded);
}

function annotateProducts(products, matchSource) {
  return products.map((product) => ({
    ...product,
    matchMeta: {
      source: matchSource,
    },
  }));
}

function buildPaginationMeta(page, pageSize, total, searchSource) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    searchSource,
  };
}

// Translate request query params into a MongoDB filter for products.
function parseCsv(value) {
  return value ? String(value).split(",").map((s) => s.trim()).filter(Boolean) : [];
}

function buildProductFilter(query) {
  const filter = {};
  if (query.category) filter.category = query.category;
  if (query.subCategory) filter.subCategory = query.subCategory;
  if (query.l3Category) filter.l3Category = query.l3Category;

  const sources = parseCsv(query.source);
  if (sources.length) filter.source = { $in: sources };

  const grades = parseCsv(query.ecoScore);
  if (grades.length) filter.ecoScore = { $in: grades };

  const minPrice = Number(query.minPrice);
  const maxPrice = Number(query.maxPrice);
  if (Number.isFinite(minPrice) && minPrice > 0) {
    filter.price = { ...(filter.price || {}), $gte: minPrice };
  }
  if (Number.isFinite(maxPrice) && maxPrice > 0) {
    filter.price = { ...(filter.price || {}), $lte: maxPrice };
  }
  return filter;
}

const ECO_GRADE_RANK = { "A+": 4, A: 3, B: 2, C: 1 };
function ecoGradeRank(grade) {
  return ECO_GRADE_RANK[grade] || 0;
}

function ecoGradeCompare(a, b) {
  return ecoGradeRank(b.ecoScore) - ecoGradeRank(a.ecoScore);
}

async function atlasTextSearch({ q, filter: filterObj = {}, sortOption }) {
  const rawQuery = String(q || "").trim();
  if (!rawQuery) return [];

  const atlasIndexName = process.env.ATLAS_SEARCH_INDEX || "default";
  const atlasSynonymsName = process.env.ATLAS_SEARCH_SYNONYMS;
  const filter = [];
  for (const [key, value] of Object.entries(filterObj)) {
    if (key === "source" && value.$in) {
      filter.push({ in: { path: "source", value: value.$in } });
    } else if (key === "ecoScore" && value.$in) {
      filter.push({ in: { path: "ecoScore", value: value.$in } });
    } else if (key === "category") {
      filter.push({ equals: { path: "category", value } });
    } else if (key === "subCategory") {
      filter.push({ equals: { path: "subCategory", value } });
    } else if (key === "l3Category") {
      filter.push({ equals: { path: "l3Category", value } });
    } else if (key === "price") {
      const range = {};
      if (value.$gte != null) range.gte = value.$gte;
      if (value.$lte != null) range.lte = value.$lte;
      if (Object.keys(range).length) filter.push({ range: { path: "price", ...range } });
    }
  }

  const expandedQueries = getExpandedQueries(rawQuery);
  const textQuery = expandedQueries.length > 0 ? expandedQueries : [rawQuery];

  const shouldClauses = [
    {
      text: {
        query: textQuery,
        path: ["title", "description", "category", "subCategory", "l3Category"],
        fuzzy: { maxEdits: 1, prefixLength: 1 },
      },
    },
    {
      autocomplete: {
        query: rawQuery,
        path: "title",
        fuzzy: { maxEdits: 1, prefixLength: 1 },
      },
    },
  ];

  // Optional Atlas synonym mapping for semantic-ish lexical aliases (e.g., copy -> notebook).
  if (atlasSynonymsName) {
    shouldClauses.push({
      text: {
        query: textQuery,
        path: ["title", "description", "category", "subCategory", "l3Category"],
        synonyms: atlasSynonymsName,
      },
    });
  }

  const searchStage = {
    $search: {
      index: atlasIndexName,
      compound: {
        should: shouldClauses,
        minimumShouldMatch: 1,
      },
    },
  };

  if (filter.length > 0) {
    searchStage.$search.compound.filter = filter;
  }

  const pipeline = [
    searchStage,
    {
      $project: {
        product_embedding: 0,
        score: { $meta: "searchScore" },
      },
    },
    { $limit: 50 },
  ];

  if (Object.keys(sortOption).length > 0) {
    pipeline.push({ $sort: sortOption });
  } else {
    pipeline.push({ $sort: { score: -1 } });
  }

  try {
    const results = await Product.aggregate(pipeline);
    console.log(`[Search] Atlas Search returned ${results.length} results.`);
    return results;
  } catch (err) {
    console.error(
      `[Search] Atlas Search failed (${atlasIndexName}). Falling back to regex search: ${err.message}`
    );
    return null;
  }
}

async function fallbackTextSearch({
  q,
  filter: filterObj = {},
  sortOption,
}) {
  const rawQuery = String(q || "").trim();
  if (!rawQuery) return [];

  const fallbackRegexes = [];
  const expandedQueries = getExpandedQueries(rawQuery);

  for (const queryText of expandedQueries) {
    const tokens = queryText.split(/\s+/).filter(Boolean);
    const flexiblePhrasePattern = tokens
      .map((token) => escapeRegex(token))
      .join("[\\s-]*");
    const compactQuery = queryText.replace(/[\s-]+/g, "");

    if (flexiblePhrasePattern) {
      fallbackRegexes.push(new RegExp(flexiblePhrasePattern, "i"));
    }
    if (compactQuery) {
      fallbackRegexes.push(new RegExp(escapeRegex(compactQuery), "i"));
    }
  }

  const textOrFilters = [];
  for (const regex of fallbackRegexes) {
    textOrFilters.push({ title: regex }, { description: regex });
  }

  if (textOrFilters.length === 0) {
    return [];
  }

  const fallbackFilter = {
    $or: textOrFilters,
    ...filterObj,
  };

  return Product.find(fallbackFilter)
    .sort(sortOption)
    .limit(50)
    .lean()
    .select("-product_embedding");
}

async function getEmbedding(text) {
  const cached = cachedEmbedding(text);
  if (cached) {
    console.log(
      `[NLP] Using cached embedding for: "${text.substring(0, 30)}..."`
    );
    return cached;
  }

  console.log(
    `[NLP] Generating REAL embedding for: "${text.substring(0, 30)}..."`
  );

  try {
    const response = await axios.post(
      MODEL_API_URL,
      { inputs: text },
      {
        headers: {
          Authorization: `Bearer ${process.env.HF_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.status !== 200 || !response.data) {
      throw new Error(`NLP API request failed with status ${response.status}`);
    }

    console.log("[NLP] Successfully generated vector.");
    storeEmbedding(text, response.data);
    return response.data;
  } catch (err) {
    console.error("[NLP] Error generating embedding:", err.message);
    return Array(384).fill(0);
  }
}

// =================================================================
// ADMIN HELPER FUNCTION
// =================================================================
function inferSourceFromUrl(productUrl) {
  try {
    const u = new URL(productUrl);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "amazon.in" || host.endsWith(".amazon.in")) return "amazon-in";
    if (host === "amazon.com" || host === "amazon.co.uk" || host === "amazon.de" || host.endsWith(".amazon.com")) return "amazon-com";
    if (host.includes("flipkart.com")) return "flipkart";
    if (host.includes("myntra.com")) return "myntra";
  } catch {
    return null;
  }
  return null;
}

function getScraperConfig(source, productId, productUrl) {
  let zenRowsEndpoint;
  let chosenUrl = productUrl;

  switch (source) {
    case "amazon-in":
      zenRowsEndpoint =
        "https://ecommerce.api.zenrows.com/v1/targets/amazon/products/";
      if (!chosenUrl) chosenUrl = `https://www.amazon.in/dp/${productId}`;
      break;
    case "amazon-com":
      zenRowsEndpoint =
        "https://ecommerce.api.zenrows.com/v1/targets/amazon/products/";
      if (!chosenUrl) chosenUrl = `https://www.amazon.com/dp/${productId}`;
      break;
    case "flipkart":
      zenRowsEndpoint = "https://api.zenrows.com/v1/";
      if (!chosenUrl) chosenUrl = `https://www.flipkart.com/${productId}`;
      break;
    case "myntra":
      zenRowsEndpoint = "https://api.zenrows.com/v1/";
      if (!chosenUrl) chosenUrl = `https://www.myntra.com/${productId}`;
      break;
    default:
      throw new Error(`Invalid source: ${source}.`);
  }
  return { zenRowsEndpoint, productUrl: chosenUrl };
}

function buildZenRowsParams(source, productUrl, apikey) {
  const params = {
    url: productUrl,
    apikey: apikey,
    js_render: true,
  };

  if (source === "myntra") {
    params.autoparse = true;
    params.wait = 3000;
    console.log(
      "[Admin] Applying Myntra settings: js_render, autoparse, wait=3000"
    );
  } else if (source === "flipkart") {
    params.css_selectors = JSON.stringify({
      title: "h1.B_NuF-",
      price: "div._30jeq3",
      imageUrl: "._3qGgA- img",
      description: "div._1mXSKH",
    });
    params.wait = 5000;
    console.log(
      "[Admin] Applying Flipkart settings: js_render, stringified_css_selectors, wait=5000"
    );
  }

  return params;
}

function cleanScrapedPrice(price) {
  if (typeof price === "number") return price;
  return parseFloat(String(price).replace(/[^0-9.]/g, ""));
}

async function fetchScrapedProduct(source, productId, productUrl) {
  let resolvedSource = source;
  if (
    !resolvedSource ||
    !["amazon-in", "amazon-com", "flipkart", "myntra"].includes(resolvedSource)
  ) {
    resolvedSource = inferSourceFromUrl(productUrl) || resolvedSource;
  }
  const { zenRowsEndpoint, productUrl: chosenUrl } = getScraperConfig(
    resolvedSource,
    productId,
    productUrl
  );

  let params;
  if (source === "amazon-in" || source === "amazon-com") {
    params = { url: productUrl, apikey: process.env.ZENROWS_API_KEY };
  } else {
    params = buildZenRowsParams(
      source,
      productUrl,
      process.env.ZENROWS_API_KEY
    );
  }

  const response = await axios.get(zenRowsEndpoint, { params });
  const data = response.data;

  let title, price, imageUrl, description;

  if (source === "amazon-in" || source === "amazon-com") {
    title = data.product_name;
    price = data.product_price;
    imageUrl =
      data.product_images && data.product_images.length > 0
        ? data.product_images[0]
        : null;
    description = data.product_description;
  } else if (source === "myntra") {
    let productData = null;
    if (Array.isArray(data)) {
      const allItems = data.flat(Infinity);
      productData = allItems.find((item) => item && item["@type"] === "Product");
    }
    if (productData) {
      title = productData.name;
      price = productData.offers ? productData.offers.price : null;
      imageUrl = productData.image;
      description = productData.description;
    }
  } else if (source === "flipkart") {
    title = data.title;
    price = data.price;
    imageUrl = data.imageUrl;
    description = data.description;
  }

  const parsedPrice = cleanScrapedPrice(price);

  if (!title || !parsedPrice || !imageUrl) {
    const err = new Error("Scraper failed to find title, price, or image.");
    err.code = "SCRAPE_INCOMPLETE";
    err.productUrl = productUrl;
    err.data = data;
    throw err;
  }

  return { title, price: parsedPrice, imageUrl, description, productUrl };
}

app.post("/api/admin/addproduct", async (req, res) => {
  try {
    const {
      productId,
      source,
      category,
      subCategory,
      l3Category,
      ecoScore,
      ecoReasons,
      adminKey,
    } = req.body;

    if (adminKey !== process.env.ADMIN_SECRET_KEY) {
      return res
        .status(401)
        .json({ message: "Unauthorized: Invalid Admin Key" });
    }
    if (!productId || !source || !category || !subCategory) {
      return res.status(400).json({
        message:
          "Missing required fields (productId, source, category, subCategory).",
      });
    }

    const existing = await Product.findOne({ productId, source });
    if (existing) {
      return res.status(400).json({
        message: `Product with this ID (${productId}) and source (${source}) already exists.`,
      });
    }

    const { productUrl } = getScraperConfig(source, productId);

    console.log(`[Admin] Calling ZenRows for ${source}: ${productId}`);
    console.log(`[Admin] Scraping URL: ${productUrl}`);

    let scraped;
    try {
      scraped = await fetchScrapedProduct(source, productId);
    } catch (scrapeError) {
      console.error(
        `[Admin] Scraper failed for ${source} ${productId}:`,
        scrapeError.message
      );
      if (scrapeError.code === "SCRAPE_INCOMPLETE") {
        console.log(`[Admin] URL Scraped: ${scrapeError.productUrl}`);
        console.log(
          `[Admin] Data Received (snippet): ${JSON.stringify(
            scrapeError.data
          ).substring(0, 200)}...`
        );
        return res.status(500).json({
          message:
            "Scraper failed to find title, price, or image. Check logs for received data.",
          url: scrapeError.productUrl,
          data: scrapeError.data,
        });
      }
      return res.status(500).json({
        message: "Scraper request failed.",
        url: scrapeError.productUrl,
        source: source,
        productId: productId,
      });
    }

    const {
      title,
      price: parsedPrice,
      imageUrl,
      description,
      productUrl: scrapedProductUrl,
    } = scraped;

    const embedding = await getEmbedding(
      `${title} ${description || ""} ${category} ${subCategory}`
    );

    const newProduct = new Product({
      productId: productId,
      source: source,
      productUrl: productUrl,
      title: title,
      price: parsedPrice,
      imageUrl: imageUrl,
      description: description,
      category: category,
      subCategory: subCategory,
      l3Category: l3Category,
      ecoScore: ecoScore,
      ecoReasons: ecoReasons,
      product_embedding: embedding,
      lastPriceUpdated: new Date(),
      priceHistory: [{ price: parsedPrice, date: new Date() }],
    });

    await newProduct.save();
    console.log(`[Admin] Successfully added product: ${title}`);
    res
      .status(201)
      .json({ message: "Product added successfully!", product: newProduct });
  } catch (err) {
    console.error("Error in /api/admin/addproduct:", err.message);
    res.status(500).json({ message: "Server error while adding product" });
  }
});

app.post("/api/admin/add-bulk", async (req, res) => {
  try {
    const { products, adminKey } = req.body;

    if (adminKey !== process.env.ADMIN_SECRET_KEY) {
      return res
        .status(401)
        .json({ message: "Unauthorized: Invalid Admin Key" });
    }
    if (!Array.isArray(products) || products.length === 0) {
      return res
        .status(400)
        .json({ message: "Request body must be an array of 'products'." });
    }

    console.log(`[Admin] Starting bulk add for ${products.length} products...`);
    const results = { success: [], errors: [] };

    for (const product of products) {
      const {
        productId,
        source,
        category,
        subCategory,
        l3Category,
        ecoScore,
        ecoReasons,
      } = product;

      let productUrl = "";

      if (!productId || !source || !category || !subCategory) {
        results.errors.push({
          productId: productId || "UNKNOWN",
          source: source || "UNKNOWN",
          error:
            "Missing required fields (productId, source, category, subCategory).",
        });
        continue;
      }

      const existing = await Product.findOne({ productId, source });
      if (existing) {
        results.errors.push({
          productId,
          source,
          error: "Product with this ID and source already exists.",
        });
        continue;
      }

      try {
        const config = getScraperConfig(source, productId);
        productUrl = config.productUrl;
        const zenRowsEndpoint = config.zenRowsEndpoint;

        console.log(`[Admin] Calling ZenRows for ${source}: ${productId}`);
        console.log(`[Admin] Scraping URL: ${productUrl}`);
        console.log(`[Admin] Using Endpoint: ${zenRowsEndpoint}`);

        let response;
        let params;
        if (source === "amazon-in" || source === "amazon-com") {
          console.log(`[Admin] Using E-commerce GET request.`);
          params = { url: productUrl, apikey: process.env.ZENROWS_API_KEY };
        } else {
          console.log(`[Admin] Using Generic GET request.`);
          params = buildZenRowsParams(
            source,
            productUrl,
            process.env.ZENROWS_API_KEY
          );
        }

        response = await axios.get(zenRowsEndpoint, { params });

        const data = response.data;
        let title, price, imageUrl, description;

        if (source === "amazon-in" || source === "amazon-com") {
          title = data.product_name;
          price = data.product_price;
          imageUrl =
            data.product_images && data.product_images.length > 0
              ? data.product_images[0]
              : null;
          description = data.product_description;
        } else if (source === "myntra") {
          let productData = null;
          if (Array.isArray(data)) {
            const allItems = data.flat(Infinity);
            productData = allItems.find(
              (item) => item && item["@type"] === "Product"
            );
          }
          if (productData) {
            title = productData.name;
            price = productData.offers ? productData.offers.price : null;
            imageUrl = productData.image;
            description = productData.description;
          }
        } else if (source === "flipkart") {
          title = data.title;
          price = data.price;
          imageUrl = data.imageUrl;
          description = data.description;
        }

        if (!title || !price || !imageUrl) {
          console.log(
            `[Admin] DEBUG: Scraper failed to find fields for ${source} ${productId}.`
          );
          console.log(`[Admin] URL Scraped: ${productUrl}`);
          console.log(
            `[Admin] Data Received (snippet): ${JSON.stringify(data).substring(
              0,
              200
            )}...`
          );
          results.errors.push({
            productId,
            source,
            error: "Scraper failed to find title, price, or image.",
            url: productUrl,
            data: data,
          });
          continue;
        }

        let cleanPrice = price;
        if (typeof price === "string") {
          cleanPrice = price.replace(/[^0-9.]/g, "");
        }

        const embedding = await getEmbedding(
          `${title} ${description || ""} ${category} ${subCategory}`
        );

        const newProduct = new Product({
          productId: productId,
          source: source,
          productUrl: productUrl,
          title: title,
          price: parseFloat(cleanPrice),
          imageUrl: imageUrl,
          description: description,
          category: category,
          subCategory: subCategory,
          l3Category: l3Category,
          ecoScore: ecoScore,
          ecoReasons: ecoReasons,
          product_embedding: embedding,
        });

        await newProduct.save();
        results.success.push({ productId, source, title: title });
        console.log(`[Admin] Successfully added product: ${title}`);
      } catch (scrapeError) {
        console.error(
          `[Admin] Error scraping ${source} ${productId}:`,
          scrapeError.message
        );
        results.errors.push({
          productId,
          source,
          error: `Scrape/Save failed: ${scrapeError.message}`,
          url: productUrl,
        });
      }
    }

    console.log(`[Admin] Bulk add finished.`);
    res.status(201).json({
      message: `Bulk operation complete. Added: ${results.success.length}, Failed: ${results.errors.length}`,
      results: results,
    });
  } catch (err) {
    console.error("Error in /api/admin/add-bulk:", err.message);
    res.status(500).json({ message: "Server error during bulk add" });
  }
});

app.post("/api/admin/remove-products", async (req, res) => {
  try {
    const { filters, adminKey } = req.body;
    if (adminKey !== process.env.ADMIN_SECRET_KEY) {
      return res
        .status(401)
        .json({ message: "Unauthorized: Invalid Admin Key" });
    }
    if (!filters || Object.keys(filters).length === 0) {
      return res
        .status(400)
        .json({ message: "No filters provided. This is a safety measure." });
    }
    console.log(
      `[Admin] Received request to delete products matching:`,
      filters
    );
    const result = await Product.deleteMany(filters);
    console.log(
      `[Admin] Deletion successful. ${result.deletedCount} products removed.`
    );
    res.status(200).json({
      message: "Deletion successful",
      deletedCount: result.deletedCount,
      filters: filters,
    });
  } catch (err) {
    console.error("Error in /api/admin/remove-products:", err.message);
    res.status(500).json({ message: "Server error during deletion" });
  }
});

// =================================================================
// PUBLIC Product Routes
// =================================================================

app.get("/api/products", async (req, res) => {
  try {
    const { category, subCategory, l3Category, sort, q } = req.query;
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(24, Math.max(4, Number.parseInt(req.query.pageSize, 10) || 12));
    const filter = buildProductFilter(req.query);
    const sortOption = {};
    switch (sort) {
      case "price-asc":
        sortOption.price = 1;
        break;
      case "price-desc":
        sortOption.price = -1;
        break;
      case "title-asc":
        sortOption.title = 1;
        break;
      default:
        break;
    }

    let products;
    let searchSource = q ? "semantic" : "catalog";

    if (q) {
      console.log(`[Search] Performing vector search for: "${q}"`);
      const queryVector = await getEmbedding(q);

      if (!queryVector || queryVector.every((v) => v === 0)) {
        console.error(
          "[Search] Failed to generate query vector. Trying Atlas Search fallback."
        );
        products = await atlasTextSearch({ q, filter, sortOption });
        if (!products || products.length === 0) {
          products = await fallbackTextSearch({ q, filter, sortOption });
          searchSource = "keyword";
        } else {
          searchSource = "fuzzy";
        }
      }
      if (products === undefined) {
        const pipeline = [
          {
            $vectorSearch: {
              index: "vector_index",
              path: "product_embedding",
              queryVector: queryVector,
              numCandidates: 150,
              limit: 120,
            },
          },
          {
            $match: filter,
          },
          {
            $project: {
              product_embedding: 0,
            },
          },
        ];

        console.log(`[Search] Executing aggregation pipeline...`);
        products = await Product.aggregate(pipeline);
        console.log(`[Search] Found ${products.length} vector results.`);
        if (products.length === 0) {
          console.log(
            "[Search] Vector search returned 0 results. Trying Atlas Search fallback."
          );
          products = await atlasTextSearch({ q, filter, sortOption });
          if (!products || products.length === 0) {
            products = await fallbackTextSearch({ q, filter, sortOption });
            searchSource = "keyword";
          } else {
            searchSource = "fuzzy";
          }
        }
      }
      if (products.length === 0) {
        trackFailedSearch(q);
        logTopFailedSearches();
      }
      if (sort === "eco") products.sort(ecoGradeCompare);
      products = annotateProducts(products, searchSource);
    } else {
      console.log(`[Search] Performing filter search.`);
      const total = await Product.countDocuments(filter);
      let results;
      if (sort === "eco") {
        results = await Product.find(filter).lean().select("-product_embedding");
        results.sort(ecoGradeCompare);
        results = results.slice((page - 1) * pageSize, page * pageSize);
      } else {
        results = await Product.find(filter)
          .sort(sortOption)
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .lean()
          .select("-product_embedding");
      }
      console.log(`[Search] Found ${results.length} filter results.`);
      res.set("Cache-Control", "public, max-age=60");
      return res.json({
        products: annotateProducts(results, searchSource),
        meta: buildPaginationMeta(page, pageSize, total, searchSource),
      });
    }
    const total = products.length;
    const pagedProducts = products.slice((page - 1) * pageSize, page * pageSize);
    res.set("Cache-Control", "public, max-age=60");
    res.json({
      products: pagedProducts,
      meta: buildPaginationMeta(page, pageSize, total, searchSource),
    });
  } catch (err) {
    console.error("Error in /api/products:", err.message);
    res.status(500).json({ message: "Server error fetching products" });
  }
});

app.get("/api/categories", async (req, res) => {
  try {
    const categories = await Product.distinct("category");
    res.json(categories);
  } catch (err) {
    console.error("Error in /api/categories:", err.message);
    res.status(500).json({ message: "Server error fetching categories" });
  }
});

app.get("/api/filters", async (req, res) => {
  try {
    const [sources, ecoScores, subCategories, priceAgg] = await Promise.all([
      Product.distinct("source"),
      Product.distinct("ecoScore"),
      Product.distinct("subCategory"),
      Product.aggregate([
        { $group: { _id: null, min: { $min: "$price" }, max: { $max: "$price" } } },
      ]),
    ]);
    res.set("Cache-Control", "public, max-age=300");
    res.json({
      sources,
      ecoScores,
      subCategories: subCategories.filter(Boolean),
      priceRange: priceAgg[0] || { min: 0, max: 0 },
    });
  } catch (err) {
    console.error("Error in /api/filters:", err.message);
    res.status(500).json({ message: "Server error fetching filters" });
  }
});

const priceRefreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get("/api/products/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).select(
      "-product_embedding"
    );
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.set("Cache-Control", "public, max-age=30");
    res.json({ product });
  } catch (err) {
    console.error("Error in /api/products/:id:", err.message);
    res.status(500).json({ message: "Server error fetching product" });
  }
});

app.get("/api/products/:id/price", priceRefreshLimiter, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const fresh = await fetchScrapedProduct(product.source, product.productId, product.productUrl);

    const oldPrice = product.price;

    if (!product.priceHistory || product.priceHistory.length === 0) {
      product.priceHistory = [{ price: oldPrice, date: new Date() }];
    } else {
      product.priceHistory.push({ price: oldPrice, date: new Date() });
      if (product.priceHistory.length > 30) {
        product.priceHistory = product.priceHistory.slice(-30);
      }
    }

    product.price = fresh.price;
    if (fresh.title) product.title = fresh.title;
    if (fresh.imageUrl) product.imageUrl = fresh.imageUrl;
    if (fresh.description) product.description = fresh.description;
    product.lastPriceUpdated = new Date();
    await product.save({ validateBeforeSave: false });

    console.log(
      `[PriceRefresh] ${product.productId || product._id} -> ₹${fresh.price} (was ₹${oldPrice})`
    );
    res.json({
      product: {
        _id: product._id,
        title: product.title,
        price: product.price,
        imageUrl: product.imageUrl,
        lastPriceUpdated: product.lastPriceUpdated,
        priceHistory: product.priceHistory,
      },
    });
  } catch (err) {
    console.error("Error in /api/products/:id/price:", err.message);
    res.status(500).json({
      message:
        err.code === "SCRAPE_INCOMPLETE"
          ? "Could not extract the current price from the site."
          : "Failed to refresh price.",
    });
  }
});

// =================================================================
// Wishlist Routes
// =================================================================

app.get("/api/wishlist", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate("wishlist");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ products: user.wishlist });
  } catch (err) {
    console.error("Error toggling wishlist:", err.message);
    res.status(500).json({ message: "Server error toggling wishlist" });
  }
});

app.post("/api/wishlist/toggle", protect, async (req, res) => {
  const { productId } = req.body;
  const userId = req.user._id;

  if (!productId) {
    return res.status(400).json({ message: "Product ID is required." });
  }
  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const productIndex = user.wishlist.findIndex((item) =>
      item.equals(productId)
    );
    if (productIndex > -1) {
      user.wishlist.pull(productId);
      await user.save();
      res.json({
        message: "Removed from Wishlist",
        wishlist: user.wishlist,
        action: "removed",
      });
    } else {
      user.wishlist.push(productId);
      await user.save();
      res.json({
        message: "Added to Wishlist",
        wishlist: user.wishlist,
        action: "added",
      });
    }
  } catch (err) {
    console.error("Error fetching wishlist:", err.message);
    res.status(500).json({ message: "Server error fetching wishlist" });
  }
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ message: "Internal server error" });
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

// =================================================================
// START THE SERVER
// =================================================================
const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
