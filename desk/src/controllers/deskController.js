const { randomUUID } = require("crypto");
const { config } = require("../config");
const db = require("../integration/db");
const { publishDeposits } = require("../integration/kafka");
const authService = require("../services/authService");
const excelService = require("../services/excelService");
const journalService = require("../services/journalService");
const customerService = require("../services/customerService");
const depositPlanService = require("../services/depositPlanService");
const drafts = require("../integration/redis");

async function login(req, res) {
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  const session = await authService.login(username, password);
  if (!session) {
    res.status(401).json({ error: "Invalid username or password", code: "invalid_credentials" });
    return;
  }
  res.setHeader("Set-Cookie", `session=${session.token}; HttpOnly; Path=/; SameSite=Lax`);
  res.json(session);
}

async function upload(req, res) {
  const banker = await authService.bankerFromRequest(req);
  if (!banker) {
    res.status(401).json({ error: "Authentication required", code: "unauthenticated" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "Excel file is required in field file", code: "file_required" });
    return;
  }

  const contentHash = excelService.hashFile(req.file.buffer);
  const workbook = excelService.readWorkbook(req.file.buffer);
  const loadId = randomUUID();
  const result = await db.transaction(async () => {
    await journalService.open({
      loadId,
      bankerId: banker.id,
      fileName: req.file.originalname,
      contentHash,
    });
    const customers = await customerService.save(workbook.customers, loadId);
    const plans = await depositPlanService.plan(workbook.deposits, customers.ids, loadId);
    const summary = buildSummary(plans, customers.saved, contentHash, req.file.originalname, banker);
    await journalService.writeSummary(loadId, summary);
    return { summary, plans };
  });
  await depositPlanService.saveDrafts(loadId, result.plans);
  res.status(201).json({
    loadId,
    ...result.summary,
    deposits: result.plans.map(depositPlanService.publicPlan),
  });
}

async function decide(req, res) {
  const banker = await authService.bankerFromRequest(req);
  if (!banker) {
    res.status(401).json({ error: "Authentication required", code: "unauthenticated" });
    return;
  }
  const decision = parseDecision(req.body?.decision ?? req.body?.answer);
  if (!decision) {
    res.status(400).json({ error: "decision must be yes or no", code: "bad_decision" });
    return;
  }

  const loadId = req.params.loadId;
  const existing = await journalService.find(loadId);
  if (!existing) {
    res.status(404).json({ error: "Load not found", code: "load_not_found" });
    return;
  }
  if (existing.decision) {
    res.status(409).json({ error: "This load already has a decision", code: "already_decided" });
    return;
  }

  if (decision === "no") {
    const depositsDeleted = await depositPlanService.deleteDrafts(loadId);
    await journalService.mark(loadId, "no");
    res.json({
      loadId,
      decision: "no",
      message: "Deposit details were deleted. Customers were kept.",
      depositsDeleted,
      customersKept: true,
    });
    return;
  }

  const approved = await depositPlanService.approved(loadId);
  if (!approved) {
    res.status(410).json({ error: "Draft expired. Upload the Excel file again.", code: "draft_expired" });
    return;
  }
  await publishDeposits(loadId, approved);
  await drafts.remove(loadId, false);
  await journalService.mark(loadId, "yes");
  res.json({
    loadId,
    decision: "yes",
    topic: config.kafkaTopic,
    message: "Approved deposits were published to the waiting topic",
    published: approved.length,
    depositIds: approved.map((deposit) => deposit.depositId),
  });
}

function buildSummary(plans, customersSaved, contentHash, fileName, banker) {
  return {
    banker,
    fileName,
    contentHash,
    customersSaved,
    summary: {
      read: plans.length,
      willLoad: plans.filter((plan) => plan.action === "will_load").length,
      alreadyExists: plans.filter((plan) => plan.action === "already_exists").length,
      duplicateInFile: plans.filter((plan) => plan.action === "duplicate_in_file").length,
      willNotLoad: plans.filter((plan) => plan.action === "will_not_load").length,
    },
  };
}

function parseDecision(value) {
  const textValue = String(value ?? "").trim().toLowerCase();
  if (["yes", "true", "1"].includes(textValue)) return "yes";
  if (["no", "false", "0"].includes(textValue)) return "no";
  return null;
}

module.exports = { login, upload, decide };
