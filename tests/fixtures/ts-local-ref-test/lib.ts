export interface MyInterface {
    a: string;
}

export function foo(arg: MyInterface) {
    console.log(arg.a);
}

export interface UnusedInterface {
    b: number;
}
