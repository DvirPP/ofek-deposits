const Redis = require("ioredis");
const { config } = require("../config");

class DraftStore {
  constructor() {
    this.client = new Redis(config.redisUrl, { maxRetriesPerRequest: 2 });
  }

  async waitUntilReady() {
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      try {
        const reply = await this.client.ping();
        if (reply === "PONG") return;
      } catch (error) {
        if (attempt === 30) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  async save(loadId, plans) {
    const pipeline = this.client.pipeline();
    pipeline.set(this.draftKey(loadId), JSON.stringify(plans), "EX", config.draftTtlSeconds);
    for (const plan of plans) {
      if (plan.action === "will_load" && plan.depositId) {
        pipeline.set(this.holdKey(plan.depositId), loadId, "EX", config.draftTtlSeconds);
      }
    }
    await pipeline.exec();
  }

  async read(loadId) {
    const raw = await this.client.get(this.draftKey(loadId));
    return raw ? JSON.parse(raw) : null;
  }

  async remove(loadId, releaseHolds) {
    const plans = await this.read(loadId);
    const pipeline = this.client.pipeline();
    pipeline.del(this.draftKey(loadId));
    if (releaseHolds && plans) {
      for (const plan of plans) {
        if (plan.action === "will_load" && plan.depositId) pipeline.del(this.holdKey(plan.depositId));
      }
    }
    await pipeline.exec();
    return plans ? plans.length : 0;
  }

  async heldByOtherLoad(ids, loadId) {
    if (ids.length === 0) return new Set();
    const owners = await this.client.mget(ids.map((id) => this.holdKey(id)));
    const taken = new Set();
    owners.forEach((owner, index) => {
      if (owner && owner !== loadId) taken.add(ids[index]);
    });
    return taken;
  }

  draftKey(loadId) {
    return `load:${loadId}`;
  }

  holdKey(depositId) {
    return `deposit-hold:${depositId}`;
  }
}

module.exports = new DraftStore();
