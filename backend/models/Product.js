const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  // --- Data from Scraper ---
  title: { type: String, required: true },
  price: { type: Number, required: true },
  imageUrl: { type: String, required: true },
  description: { type: String, default: 'No description available.' },
  
  // --- Multi-store fields ---
  productId: { type: String, required: true },
  source: { type: String, required: true },
  productUrl: { type: String, required: true },

  // --- Data you add manually ---
  category: { type: String, required: true },
  subCategory: { type: String, required: true },
  l3Category: { type: String },

  // --- Eco-Data ---
  ecoScore: {
    type: String,
    enum: ['A+', 'A', 'B', 'C'],
    default: 'A'
  },
  ecoReasons: {
    type: [String],
    default: []
  },


  product_embedding: {
    type: [Number] 
  }
});


productSchema.index({ productId: 1, source: 1 }, { unique: true });

const Product = mongoose.model("Product", productSchema);
module.exports = { Product };