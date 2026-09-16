export class UserSchema { /* ... */ }
export const ProductType = { /* ... */ };
export function Query() { /* ... */ }

// This export should be marked as unused by default, but protected by Layer 5
export const UnusedButExternal = 123;

// Example of a decorated class that should be protected
function Entity() { return (target: any) => target; }
@Entity()
export class OrderEntity { /* ... */ }
