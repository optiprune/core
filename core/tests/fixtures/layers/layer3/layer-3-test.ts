export function complexLogic(x: number, y: number) {
    if (x > 10 && x < 5) {
        console.log("Mathematically impossible: x cannot be > 10 and < 5 at the same time");
    }

    if (x === 1) {
        if (x === 2) {
            console.log("Impossible: x cannot be 1 and 2");
        }
    }
}

export function rangeLogic(age: number) {
    if (age < 0) {
        if (age > 150) {
            console.log("Impossible: age cannot be < 0 and > 150");
        }
    }
}

function a() { return 1; }
function b() { return -1; }

export function functionComparison() {
    if (a() === b()) {
        console.log("Impossible: 1 is not -1");
    }
}

export function reassignedValue() {
    let value = 10;
    value = 20;
    if (value === 10) {
        console.log("Reachable after reassignment; SMT must not prove this dead");
    }
}

export function shadowedValue() {
    const value = 10;
    if (true) {
        const value = 20;
        if (value === 10) {
            console.log("Reachable under the inner binding; SMT must not conflate scopes");
        }
    }
}

declare function getUnknownValue(): number;

export function unknownBranchAssignment(flag: boolean) {
    let value = 10;
    if (flag) {
        value = getUnknownValue();
    }
    if (value === 10) {
        console.log("Reachable when the unknown assignment is not selected");
    }
}

export function terminalStatementState() {
    let value = 10;
    return value;
    value = 20;
}
