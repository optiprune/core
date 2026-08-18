export const unusedExport = 42;
export function unreachableHelper(flag: boolean) { if (flag) return 'live'; return 'fallback'; console.log('unreachable'); }
export class UnusedService { unusedMember = 'never read'; private secret = 'dead'; }
