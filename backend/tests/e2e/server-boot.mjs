import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { spawn } from "node:child_process";

const SAMPLE_PRODUCTS = [
  { title: "Bamboo Toothbrush Set", price: 199, imageUrl: "https://via.placeholder.com/300", category: "Home", subCategory: "Bath", ecoScore: "A+", ecoReasons: ["Bamboo", "Biodegradable", "Plastic-Free"], productId: "e2e-1", source: "amazon-in", productUrl: "https://www.amazon.in/dp/e2e1" },
  { title: "Reusable Glass Bottle", price: 349, imageUrl: "https://via.placeholder.com/300", category: "Home", subCategory: "Kitchen", ecoScore: "A+", ecoReasons: ["Reusable", "BPA-Free", "Durable Glass"], productId: "e2e-2", source: "amazon-in", productUrl: "https://www.amazon.in/dp/e2e2" },
  { title: "Solar Garden Light", price: 599, imageUrl: "https://via.placeholder.com/300", category: "Garden", subCategory: "Lighting", ecoScore: "A", ecoReasons: ["Solar Powered", "LED"], productId: "e2e-3", source: "flipkart", productUrl: "https://www.flipkart.com/p/e2e3" },
  { title: "Organic Cotton Tote", price: 249, imageUrl: "https://via.placeholder.com/300", category: "Fashion", subCategory: "Bags", ecoScore: "A", ecoReasons: ["Organic", "Reusable", "Sustainable"], productId: "e2e-4", source: "myntra", productUrl: "https://www.myntra.com/p/e2e4" },
  { title: "Soy Wax Candle", price: 450, imageUrl: "https://via.placeholder.com/300", category: "Home", subCategory: "Decor", ecoScore: "A", ecoReasons: ["Soy Wax", "Aromatherapy", "Eco-Friendly"], productId: "e2e-5", source: "amazon-in", productUrl: "https://www.amazon.in/dp/e2e5" },
  { title: "Recycled Notebook", price: 129, imageUrl: "https://via.placeholder.com/300", category: "Stationery", subCategory: "Paper", ecoScore: "B", ecoReasons: ["Recycled", "Eco-Friendly Material"], productId: "e2e-6", source: "flipkart", productUrl: "https://www.flipkart.com/p/e2e6" },
  { title: "Jute Placemats", price: 320, imageUrl: "https://via.placeholder.com/300", category: "Home", subCategory: "Kitchen", ecoScore: "B", ecoReasons: ["Jute", "Natural"], productId: "e2e-7", source: "amazon-in", productUrl: "https://www.amazon.in/dp/e2e7" },
  { title: "Compostable Plates", price: 275, imageUrl: "https://via.placeholder.com/300", category: "Home", subCategory: "Kitchen", ecoScore: "C", ecoReasons: ["Compostable"], productId: "e2e-8", source: "myntra", productUrl: "https://www.myntra.com/p/e2e8" },
];

const mongod = await MongoMemoryServer.create();
const uri = mongod.getUri("ecofi_test");

const client = new MongoClient(uri);
await client.connect();
const db = client.db();
if ((await db.collection("products").countDocuments()) === 0) {
  await db.collection("products").insertMany(
    SAMPLE_PRODUCTS.map((p) => ({ ...p, lastPriceUpdated: new Date(), priceHistory: [{ price: p.price, date: new Date() }] }))
  );
}
await client.close();

process.env.MONGO_URI = uri;
process.env.JWT_SECRET = process.env.JWT_SECRET || "e2e-secret";
process.env.ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || "e2e-admin";
process.env.HF_API_KEY = process.env.HF_API_KEY || "x";
process.env.ZENROWS_API_KEY = process.env.ZENROWS_API_KEY || "x";
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
process.env.PORT = process.env.PORT || "4000";

const app = spawn("node", ["server.js"], { stdio: "inherit", env: process.env });

async function shutdown(code) {
  app.kill();
  await mongod.stop().catch(() => {});
  process.exit(code ?? 0);
}
app.on("exit", (code) => shutdown(code));
process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
