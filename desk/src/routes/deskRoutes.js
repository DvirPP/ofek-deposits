const express = require("express");
const multer = require("multer");
const db = require("../integration/db");
const deskController = require("../controllers/deskController");
const processingController = require("../controllers/processingController");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const router = express.Router();

router.get("/health", async (_req, res, next) => {
  try {
    await db.query("SELECT 1");
    res.json({ status: "ok", service: "desk" });
  } catch (error) {
    next(error);
  }
});

router.post("/login", (req, res, next) => {
  deskController.login(req, res).catch(next);
});

router.post("/loads", upload.single("file"), (req, res, next) => {
  deskController.upload(req, res).catch(next);
});

router.post("/loads/:loadId/decision", (req, res, next) => {
  deskController.decide(req, res).catch(next);
});

router.get("/loads/:loadId/rejections", (req, res, next) => {
  deskController.rejections(req, res).catch(next);
});

router.get("/processing/pending", (req, res, next) => {
  processingController.pending(req, res).catch(next);
});

router.post("/processing", (req, res, next) => {
  processingController.processPending(req, res).catch(next);
});

router.post("/retries", (req, res, next) => {
  processingController.retry(req, res).catch(next);
});

module.exports = router;
