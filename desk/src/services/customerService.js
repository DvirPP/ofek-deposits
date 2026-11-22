const db = require("../integration/db");

async function save(customers, loadId) {
  const saved = new Set();
  for (const customer of customers) {
    await db.query(
      `INSERT INTO customers (
         customer_id, full_name, national_id, phone, email, city, segment,
         branch_code, branch_name, account_number, status, opened_date, load_id, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
       ON CONFLICT (customer_id) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         national_id = EXCLUDED.national_id,
         phone = EXCLUDED.phone,
         email = EXCLUDED.email,
         city = EXCLUDED.city,
         segment = EXCLUDED.segment,
         branch_code = EXCLUDED.branch_code,
         branch_name = EXCLUDED.branch_name,
         account_number = EXCLUDED.account_number,
         status = EXCLUDED.status,
         opened_date = EXCLUDED.opened_date,
         load_id = EXCLUDED.load_id,
         updated_at = now()`,
      [
        customer.customerId,
        customer.fullName,
        customer.nationalId,
        customer.phone,
        customer.email,
        customer.city,
        customer.segment,
        customer.branchCode,
        customer.branchName,
        customer.accountNumber,
        customer.status,
        customer.openedDate,
        loadId,
      ],
    );
    saved.add(customer.customerId);
  }
  return { saved: saved.size };
}

async function directory() {
  const found = await db.query("SELECT customer_id, account_number, status FROM customers");
  return found.rows.map((row) => ({
    customerId: row.customer_id,
    accountNumber: row.account_number,
    status: row.status,
  }));
}

module.exports = { save, directory };
