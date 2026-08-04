export function unreachableAfterReturn() {
    console.log("This is reachable");
    return true;
    console.log("This is unreachable");
}

export function unreachableAfterThrow() {
    throw new Error("Failed");
    console.log("This is unreachable");
}

export function constantConditionIf() {
    if (false) {
        console.log("Never happens");
    }

    if (true) {
        console.log("Always happens");
    } else {
        console.log("Never happens (else)");
    }
}

export function constantConditionWhile() {
    while (false) {
        console.log("Never loops");
    }
}

export function contradictoryGuard(x: number) {
    if (x === 1 && x === 2) {
        console.log("Impossible");
    }
}

type MyType = "A" | "B";

function assertNever(x: never): never {
    throw new Error("Unexpected");
}

export function exhaustiveCheck(val: MyType) {
    switch (val) {
        case "A":
            return 1;
        case "B":
            return 2;
        default:
            assertNever(val);
    }
}
