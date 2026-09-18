export class Feature {
  static configuration;
  static {
    if (process.env.C8_FIXTURE_MODE === 'enabled') {
      Feature.configuration = 'enabled';
    } else {
      Feature.configuration = 'default';
    }
  }

  myHandler = () => 'unused class field arrow';
  activeHandler = () => 'active arrow';

  #unusedPrivateMethod() {
    return 'dead private method';
  }

  #value = 7;

  getValue() {
    return this.#value;
  }

  prototypeMethod() {
    return 'prototype method';
  }
}
