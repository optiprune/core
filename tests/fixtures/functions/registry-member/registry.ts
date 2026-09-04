class Registry {
  private items = new Map<string, any>();
  private unused = "unused";

  constructor() {
    this.items.set("core", "system");
  }

  get(key: string) {
    return this.items.get(key);
  }

  remove(key: string) {
    this.items.delete(key);
  }
}

export function makeRegistry() {
  return new Registry();
}
