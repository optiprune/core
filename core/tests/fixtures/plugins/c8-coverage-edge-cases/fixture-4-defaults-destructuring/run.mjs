import { connect, configure, inspectList } from './fixture.mjs';
console.log(connect(3000, 'http'));
console.log(configure({ timeout: 1000, retries: 1 }));
console.log(inspectList({ head: 'first', tail: 'unused' }));
