// Minimal ambient declarations for repository TypeScript checks. The hosted
// Edge runtime supplies the complete Deno API at execution time.
declare namespace Deno {
  namespace env {
    function get(name: string): string | undefined;
  }

  function serve(
    handler: (request: Request) => Response | Promise<Response>,
  ): unknown;
}
