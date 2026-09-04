export interface MyInterface {
    a: string;
}

export function foo(arg: MyInterface) {
    console.log(arg.a);
}

export interface PartiallyUsedInterface {
    used: string;
    unused: number;
}

export function partial(arg: PartiallyUsedInterface) {
    console.log(arg.used);
}

export interface UnusedInterface {
    b: number;
}
