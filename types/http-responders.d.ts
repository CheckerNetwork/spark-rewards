declare module 'http-responders' {
  import type { ServerResponse } from 'http';

  export function json(res: ServerResponse, data: any): void;
  export function status(res: ServerResponse, code: number): void;
}
