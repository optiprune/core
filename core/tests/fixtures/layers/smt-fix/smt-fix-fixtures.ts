export function arithmeticContradiction(a: number) {
    if (a > 20 && a < 5) {
        console.log("Impossible: a cannot be > 20 and < 5");
    }
}

export function randomReasoning() {
    if (Math.random() > 2) {
        console.log("Impossible: Math.random() is always < 1");
    }
    if (Math.random() < -1) {
        console.log("Impossible: Math.random() is always >= 0");
    }
}

function alwaysFalse() {
    return false;
}

function alwaysTrue() {
    return true;
}

export function functionCallReasoning() {
    if (alwaysFalse()) {
        console.log("Impossible: alwaysFalse() returns false");
    }
    
    if (!alwaysTrue()) {
        console.log("Impossible: alwaysTrue() returns true, so !alwaysTrue() is false");
    }
}

export function unaryReasoning() {
    if (!true) {
        console.log("Impossible: !true is false");
    }
    if (!!false) {
        console.log("Impossible: !!false is false");
    }
}

export function memberReasoning(obj: { prop: number }) {
    if (obj.prop === 1 && obj.prop === 2) {
        console.log("Impossible: same property cannot be 1 and 2");
    }
}

export function mixedTypeReasoning(x: any) {
    // This might be tricky depending on how we handle 'any'
    // but if we treat x as a symbolic variable, it should be consistent.
    if (x === 1) {
        if (x === "1") {
            // In JS 1 == "1" is true, but 1 === "1" is false.
            // OptiPrune uses ===/== interchangeably in its current SMT if not careful.
            // We should see how it handles this.
        }
    }
}
