export namespace Sizes {
  export const Size = 1;
  export const unused = 2;
  export namespace Inner {
    export const Deep = 3;
  }
  export function use() {
    return Size + Inner.Deep;
  }
}
export namespace Shadow {
  export const value = 1;
  export function read(value: number) { return value; }
}
