export class WecomError extends Error {
  status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.name = "WecomError";
    this.status = status;
  }
}
