console.log("✅ Server file started running");

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const dotenv = require("dotenv");
const { User } = require("./models/User.js");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err.message));

// Root route
app.get("/", (req, res) => res.send("EcoFi backend running 🚀"));

// Signup route
app.post("/api/signup", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ message: "All fields required" });

  const existing = await User.findOne({ email });
  if (existing) return res.status(400).json({ message: "Email already registered" });

  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({ name, email, password: hashed });

  res.json({
    message: "Account created successfully",
    user: { name: user.name, email: user.email, joinDate: user.joinDate },
  });
});

// Login route
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(400).json({ message: "Invalid email or password" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ message: "Invalid email or password" });

  const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

  res.json({
    message: "Login successful",
    token,
    user: { name: user.name, email: user.email, joinDate: user.joinDate },
  });
});

// Profile route
app.get("/api/profile", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ message: "No token provided" });

  try {
    const decoded = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ user });
  } catch {
    res.status(403).json({ message: "Invalid or expired token" });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
