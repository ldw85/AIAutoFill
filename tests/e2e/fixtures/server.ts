import http from 'node:http';
import { AddressInfo } from 'node:net';

export class FixtureServer {
  private server: http.Server | null = null;
  private port: number | null = null;

  constructor(private readonly routes: Record<string, string>) {}

  async start(): Promise<void> {
    if (this.server) return;
    this.server = http.createServer((req, res) => {
      const url = req.url ? new URL(req.url, 'http://127.0.0.1') : null;
      const pathname = url?.pathname ?? '/';
      const body = this.routes[pathname];
      if (!body) {
        res.statusCode = 404;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end('Not found');
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(body);
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(0, '127.0.0.1', () => {
        const address = this.server!.address() as AddressInfo;
        this.port = address.port;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => {
      this.server!.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    this.server = null;
    this.port = null;
  }

  urlFor(pathname: string): string {
    if (this.port == null) {
      throw new Error('Fixture server not started');
    }
    return `http://127.0.0.1:${this.port}${pathname}`;
  }
}
