const express = require("express");
const bcrypt = require("bcrypt");
const { z } = require("zod");
const PlatformAdmin = require("../models/PlatformAdmin");
const { signPlatformAccessToken } = require("../utils/jwt");
const jwt = require("jsonwebtoken");

const router = express.Router();

const RegisterSchema = z.object({
  email: z.string().email(),
  username: z.string().min(2),
  password: z.string().min(10),
  isSuper: z.boolean().optional(),
});
const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

router.post("/register", async (req, res) => {
  try {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid payload" });
    const { email, username, password, isSuper } = parsed.data;

    const exists = await PlatformAdmin.findOne({ email }).lean();
    if (exists) return res.status(409).json({ ok: false, error: "Email already in use" });

    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await PlatformAdmin.create({ email, username, passwordHash, isSuper: !!isSuper });

    const token = signPlatformAccessToken({ admin });
    res.json({ ok: true, token, user: { id: String(admin._id), email, username } });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid payload" });

    const { email, password } = parsed.data;
    const admin = await PlatformAdmin.findOne({ email });
    if (!admin) return res.status(400).json({ ok: false, error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) return res.status(400).json({ ok: false, error: "Invalid credentials" });

    const token = signPlatformAccessToken({ admin });
    res.json({ ok: true, token, user: { id: String(admin._id), email: admin.email, username: admin.username } });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

router.get("/verify", (req, res) => {
  const bearer = req.headers.authorization || "";
  const [, token] = bearer.split(" ");
  if (!token) return res.status(401).json({ ok: false, error: "No token" });
  try {
    const dec = jwt.verify(token, process.env.JWT_SECRET);
    if (dec.aud !== "platform-admin") return res.status(401).json({ ok: false, error: "Wrong audience" });
    res.json({ ok: true, user: dec });
  } catch {
    res.status(401).json({ ok: false, error: "Invalid token" });
  }
});

module.exports = router;
