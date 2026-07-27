class MutationRegistry {
  constructor() {
    this.active = new Set();
  }

  run(work) {
    if (typeof work !== 'function') {
      return Promise.reject(new TypeError('Mutation work must be a function'));
    }
    const operation = Promise.resolve().then(work);
    this.active.add(operation);
    const remove = () => this.active.delete(operation);
    operation.then(remove, remove);
    return operation;
  }

  get pending() {
    return this.active.size;
  }

  async drain(timeoutMs = 30000) {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs || 0));
    while (this.active.size > 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return this.active.size;
      let timer = null;
      await Promise.race([
        Promise.allSettled(Array.from(this.active)),
        new Promise((resolve) => {
          timer = setTimeout(resolve, remaining);
        })
      ]);
      if (timer) clearTimeout(timer);
    }
    return 0;
  }
}

module.exports = { MutationRegistry };
