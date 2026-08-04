function Injectable() { return (target: any) => target; }

@Injectable()
export class UnusedService {}
