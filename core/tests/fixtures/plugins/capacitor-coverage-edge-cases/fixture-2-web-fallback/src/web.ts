export class WebPlugin {
  protected unimplemented(): never { throw new Error('unimplemented'); }
}

export class Web extends WebPlugin {
  async liveMethod() { return navigator.clipboard.readText(); }
  async nativeOnly() { return this.unimplemented(); }
}

function replacedHelper(value: string) { return value.trim(); }
function orphanHelper(value: string) { return replacedHelper(value); }
void orphanHelper;
