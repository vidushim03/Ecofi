console.log("✅ RUNNING THE SERVER.JS FILE ✅");

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const dotenv = require("dotenv");
const { User } = require("./models/User.js");
const { Product } = require("./models/Product.js");
const axios = require("axios");

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

app.use(cors(corsOptions));
app.use(express.json());

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err.message));

app.get("/", (req, res) => res.send("EcoFi backend running 🚀"));

const protect = async (req, res, next) => {
  let token;
  const auth = req.headers.authorization;

  if (auth && auth.startsWith("Bearer")) {
    try {
      token = auth.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      req.user = await User.findById(decoded.id).select("-password");

      if (!req.user) {
        return res.status(401).json({ message: "User not found" });
      }
      next();
    } catch (err) {
      let message = "Not authorized";
      if (err.name === "JsonWebTokenError") message = "Invalid token";
      if (err.name === "TokenExpiredError") message = "Expired token";
      return res.status(401).json({ message });
    }
  }

  if (!token) {
    return res.status(401).json({ message: "Not authorized, no token" });
  }
};

// =================================================================
// Authentication Routes
// =================================================================
app.post("/api/signup", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ message: "All fields required" });
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
  res.json({
    message: "Account created successfully",
    token,
    user: { name: user.name, email: user.email, joinDate: user.joinDate },
  });
});

app.post("/api/login", async (req, res) => {
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
  res.json({
    message: "Login successful",
    token,
    user: { name: user.name, email: user.email, joinDate: user.joinDate },
  });
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
    res
      .status(500)
      .json({ message: "Error updating profile", error: err.message });
  }
});

app.delete("/api/profile", protect, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.user._id);

    res.json({ message: "Account deleted successfully" });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error deleting account", error: err.message });
  }
});

// =================================================================
// EMBEDDING HELPER FUNCTION
// =================================================================
const MODEL_API_URL = "https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2";

async function getEmbedding(text) {
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
    return response.data;
  } catch (err) {
    console.error("[NLP] Error generating embedding:", err.message);
    return Array(384).fill(0);
  }
}

// =================================================================
// ADMIN HELPER FUNCTION
// =================================================================
function getScraperConfig(source, productId) {
  let zenRowsEndpoint;
  let productUrl;

  switch (source) {
    case "amazon-in":
      zenRowsEndpoint =
        "https://ecommerce.api.zenrows.com/v1/targets/amazon/products/";
      productUrl = `https://www.amazon.in/dp/${productId}`;
      break;
    case "amazon-com":
      zenRowsEndpoint =
        "https://ecommerce.api.zenrows.com/v1/targets/amazon/products/";
      productUrl = `https://www.amazon.com/dp/${productId}`;
      break;
    case "flipkart":
      zenRowsEndpoint = "https://api.zenrows.com/v1/";
      productUrl = `https://www.flipkart.com/${productId}`;
      break;
    case "myntra":
      zenRowsEndpoint = "https://api.zenrows.com/v1/";
      productUrl = `https://www.myntra.com/${productId}`;
      break;
    default:
      throw new Error(`Invalid source: ${source}.`);
  }
  return { zenRowsEndpoint, productUrl };
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

    const { zenRowsEndpoint, productUrl } = getScraperConfig(source, productId);

    console.log(`[Admin] Calling ZenRows for ${source}: ${productId}`);
    console.log(`[Admin] Scraping URL: ${productUrl}`);
    console.log(`[Admin] Using Endpoint: ${zenRowsEndpoint}`);

    let response;
    try {
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
    } catch (scrapeError) {
      console.error(
        `[Admin] HTTP Error scraping URL: ${productUrl}`,
        scrapeError.message
      );
      if (scrapeError.response) {
        console.error(
          `[Admin] ZenRows Error Status: ${scrapeError.response.status}`
        );
        console.error(`[Admin] ZenRows Error Data:`, scrapeError.response.data);
      }
      return res.status(500).json({
        message: `Scraper request failed: ${scrapeError.message}`,
        url: productUrl,
        source: source,
        productId: productId,
      });
    }

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
      return res.status(500).json({
        message:
          "Scraper failed to find title, price, or image. Check logs for received data.",
        url: productUrl,
        data: data,
      });
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
    console.log(`[Admin] Successfully added product: ${title}`);
    res
      .status(201)
      .json({ message: "Product added successfully!", product: newProduct });
  } catch (err) {
    console.error("Error in /api/admin/addproduct:", err.message);
    res
      .status(500)
      .json({ message: "Server error while adding product", error: err.message });
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
    res
      .status(500)
      .json({ message: "Server error during bulk add", error: err.message });
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
    res
      .status(500)
      .json({ message: "Server error during deletion", error: err.message });
  }
});

// =================================================================
// PUBLIC Product Routes
// =================================================================

app.get("/api/products", async (req, res) => {
  try {
    const { category, subCategory, l3Category, sort, q } = req.query;
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

    if (q) {
      console.log(`[Search] Performing vector search for: "${q}"`);
      const queryVector = await getEmbedding(q);

      if (!queryVector || queryVector.every((v) => v === 0)) {
        console.error(
          "[Search] Failed to generate query vector. Falling back to text search."
        );
        const regex = new RegExp(q, "i");
        const fallbackFilter = {
          $or: [{ title: regex }, { description: regex }],
        };
        if (category) fallbackFilter.category = category;
        if (subCategory) fallbackFilter.subCategory = subCategory;
        if (l3Category) fallbackFilter.l3Category = l3Category;

        products = await Product.find(fallbackFilter)
          .sort(sortOption)
          .limit(50)
          .select("-product_embedding");
        return res.json({ products });
      }

      const pipeline = [
        {
          $vectorSearch: {
            index: "vector_index",
            path: "product_embedding",
            queryVector: queryVector,
            numCandidates: 100,
            limit: 50,
          },
        },
        {
          $match: {},
        },
        {
          $project: {
            product_embedding: 0,
          },
        },
      ];

      if (category) pipeline[1].$match.category = category;
      if (subCategory) pipeline[1].$match.subCategory = subCategory;
      if (l3Category) pipeline[1].$match.l3Category = l3Category;

      console.log(`[Search] Executing aggregation pipeline...`);
      products = await Product.aggregate(pipeline);
      console.log(`[Search] Found ${products.length} vector results.`);
    } else {
      console.log(`[Search] Performing filter search.`);
      const filter = {};
      if (category) filter.category = category;
      if (subCategory) filter.subCategory = subCategory;
      if (l3Category) filter.l3Category = l3Category;

      products = await Product.find(filter)
        .sort(sortOption)
        .select("-product_embedding");
      console.log(`[Search] Found ${products.length} filter results.`);
    }

    res.json({ products });
  } catch (err) {
    console.error("Error in /api/products:", err.message);
    res.status(500).json({
      message: "Server error fetching products",
      error: err.message,
    });
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

// =================================================================
// Wishlist Routes
// =================================================================

app.get("/api/wishlist", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate("wishlist");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ products: user.wishlist });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Server error fetching wishlist", error: err.message });
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
    console.error("Error toggling wishlist:", err.message);
    res
      .status(500)
      .json({ message: "Server error toggling wishlist", error: err.message });
  }
});

// =================================================================
// START THE SERVER
// =================================================================
const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
