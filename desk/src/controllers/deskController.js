const { randomUUID } = require("crypto");
const db = require("../integration/db");
const authService = require("../services/authService");
const excelService = require("../services/excelService");
const journalService = require("../services/journalService");
const customerService = require("../services/customerService");
const depositPlanService = require("../services/depositPlanService");
const intakeService = require("../services/intakeService");

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
  const reusable = await journalService.findReusable(contentHash);
  if (reusable?.preview?.publicBody) {
    res.status(200).json({ ...reusable.preview.publicBody, replay: true });
    return;
  }

  const workbook = excelService.readWorkbook(req.file.buffer);
  const knownCustomers = await customerService.directory();
  const takenDepositIds = await intakeService.canonicalDepositIds();
  const planned = depositPlanService.plan({
    customers: workbook.customers,
    deposits: workbook.deposits,
    knownCustomers,
    takenDepositIds,
  });
  const loadId = randomUUID();
  const publicBody = buildPublic(loadId, banker, req.file.originalname, contentHash, planned);
  try {
    await journalService.open({
      loadId,
      bankerId: banker.id,
      fileName: req.file.originalname,
      contentHash,
      summary: publicBody.summary,
      preview: {
        validCustomers: planned.validCustomers,
        customerRejections: planned.customerRejections,
        deposits: planned.deposits,
        publicBody,
      },
    });
  } catch (error) {
    if (error.code !== "23505") throw error;
    const again = await journalService.findReusable(contentHash);
    if (!again?.preview?.publicBody) throw error;
    res.status(200).json({ ...again.preview.publicBody, replay: true });
    return;
  }
  res.status(201).json(publicBody);
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
  const existing = await journalService.read(loadId);
  if (!existing) {
    res.status(404).json({ error: "Load not found", code: "load_not_found" });
    return;
  }
  if (existing.decision) {
    res.status(409).json({ error: "This load already has a decision", code: "already_decided" });
    return;
  }
  if (!existing.preview) {
    res.status(410).json({ error: "This preview is no longer available", code: "preview_missing" });
    return;
  }

  if (decision === "no") {
    await journalService.discard(loadId);
    res.json({
      loadId,
      decision: "no",
      message: "Nothing was saved.",
      depositsDeleted: 0,
      customersKept: false,
    });
    return;
  }

  const preview = existing.preview;
  try {
    await db.transaction(async () => {
      const customers = await customerService.save(preview.validCustomers, loadId);
      await intakeService.saveDeposits(loadId, preview.deposits);
      await intakeService.saveCustomerRejections(loadId, preview.customerRejections);
      const summary = {
        ...preview.publicBody.summary,
        customersSaved: customers.saved,
        loaded: preview.deposits.filter((plan) => plan.accepted).length,
        rejected: preview.deposits.filter((plan) => !plan.accepted).length + preview.customerRejections.length,
      };
      await journalService.writeSummary(loadId, summary);
      await journalService.mark(loadId, "yes");
    });
  } catch (error) {
    if (error.code === "23505") {
      error.status = 409;
      error.message = "A deposit id was already saved";
      error.code = "deposit_exists";
    }
    throw error;
  }

  const accepted = preview.deposits.filter((plan) => plan.accepted).length;
  const rejected = preview.deposits.filter((plan) => !plan.accepted).length + preview.customerRejections.length;
  res.json({
    loadId,
    decision: "yes",
    message: "Customers and deposit rows were saved. Pending deposits were not published.",
    customersSaved: preview.validCustomers.length,
    loaded: accepted,
    rejected,
    pending: preview.publicBody.summary.willLoad,
    failedFromFile: preview.publicBody.summary.failedFromFile,
    published: 0,
    topic: null,
    depositIds: [],
  });
}

async function rejections(req, res) {
  const banker = await authService.bankerFromRequest(req);
  if (!banker) {
    res.status(401).json({ error: "Authentication required", code: "unauthenticated" });
    return;
  }
  const load = await journalService.read(req.params.loadId);
  if (!load) {
    res.status(404).json({ error: "Load not found", code: "load_not_found" });
    return;
  }

  const customerRows = load.decision === "yes"
    ? (await intakeService.customerRejections(load.load_id)).map((row) => ({
        row: row.row_number,
        customer_id: row.customer_id,
        reason: row.reason,
      }))
    : (load.preview?.customerRejections ?? []).map((row) => ({
        row: row.row,
        customer_id: row.customerId,
        reason: row.reason,
      }));
  const depositRows = load.decision === "yes"
    ? (await intakeService.depositRejections(load.load_id)).map((row) => ({
        row: row.row_number,
        deposit_id: row.deposit_id,
        customer_id: row.customer_id,
        reason: row.rejection_reason,
        source_status: row.source_status,
      }))
    : (load.preview?.deposits ?? [])
        .filter((plan) => !plan.accepted)
        .map((plan) => ({
          row: plan.row,
          deposit_id: plan.depositId,
          customer_id: plan.customerId,
          reason: plan.reason,
          source_status: plan.sourceStatus,
        }));

  const body = excelService.rejectionWorkbook(customerRows, depositRows);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="rejections-${load.load_id}.xlsx"`);
  res.send(body);
}

function buildPublic(loadId, banker, fileName, contentHash, planned) {
  return {
    loadId,
    banker,
    fileName,
    contentHash,
    customersSaved: planned.validCustomers.length,
    customersStored: false,
    summary: depositPlanService.summarize(
      planned.deposits,
      planned.customerRejections,
      planned.validCustomers.length + planned.customerRejections.length,
      planned.validCustomers.length,
    ),
    customerRejections: planned.customerRejections,
    deposits: planned.deposits.map(depositPlanService.publicPlan),
  };
}

function parseDecision(value) {
  const textValue = String(value ?? "").trim().toLowerCase();
  if (["yes", "true", "1"].includes(textValue)) return "yes";
  if (["no", "false", "0"].includes(textValue)) return "no";
  return null;
}

module.exports = { login, upload, decide, rejections };
