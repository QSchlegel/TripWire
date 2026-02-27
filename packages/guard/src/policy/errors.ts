export class PolicyCompileError extends Error {
  public readonly code: string;
  public readonly line: number;
  public readonly column: number;

  public constructor(message: string, code: string, line: number, column: number) {
    super(message);
    this.name = "PolicyCompileError";
    this.code = code;
    this.line = line;
    this.column = column;
  }
}
