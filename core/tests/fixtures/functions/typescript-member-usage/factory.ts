export interface Product { live: string; dead: string; }
export function make(): Product { return { live: 'live', dead: 'dead' }; }
