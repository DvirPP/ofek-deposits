const depositService = require("../services/depositService");

async function read(req, res) {
  const found = await depositService.read(req.params.depositId);
  if (!found) {
    res.status(404).json({ error: "Deposit case not found", code: "case_not_found" });
    return;
  }
  res.json(found);
}

async function history(req, res) {
  const found = await depositService.read(req.params.depositId);
  if (!found) {
    res.status(404).json({ error: "Deposit case not found", code: "case_not_found" });
    return;
  }
  res.json({ depositId: req.params.depositId, events: await depositService.history(req.params.depositId) });
}

async function list(req, res) {
  const status = String(req.query.status ?? "").trim();
  if (status && !["Processing", "Completed", "Failed", "PendingApproval"].includes(status)) {
    res.status(400).json({ error: "Unknown status", code: "bad_status" });
    return;
  }
  res.json({ deposits: await depositService.list(status || null) });
}

async function approval(req, res) {
  const decision = String(req.body?.decision ?? "").trim().toLowerCase();
  if (decision !== "approve" && decision !== "reject") {
    res.status(400).json({ error: "decision must be approve or reject", code: "bad_decision" });
    return;
  }
  const result = await depositService.decideApproval(req.params.depositId, decision);
  if (result.error === "not_found") {
    res.status(404).json({ error: "Deposit case not found", code: "case_not_found" });
    return;
  }
  if (result.error === "not_pending") {
    res.status(409).json({
      error: "Deposit is not waiting for approval",
      code: "not_pending_approval",
      status: result.status,
    });
    return;
  }
  res.json(result.case);
}

module.exports = { read, history, list, approval };
