/** Reads what the API routes answer, on the client. */
export class ApiResponse {
  /**
   * The error a failed route reports (`apiError`'s `{ error: { message } }`), or `fallback` when the body
   * says nothing, such as a proxy's HTML error page.
   */
  static async error(response: Response, fallback: string): Promise<Error> {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;

    return new Error(body?.error?.message ?? fallback);
  }
}
