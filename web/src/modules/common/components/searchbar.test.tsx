import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt, serve } from "#app/mock/page.tsx";

const listing = { apps: [], counts: { installed: 0, available: 0 } };

/** The navbar's search field. */
function field(): HTMLInputElement {
  return screen.getByLabelText("Search", { selector: "input" });
}

/** What `?q=` the router shows. */
function query(router: ReturnType<typeof renderAt>): unknown {
  return (router.state.location.search as { q?: unknown }).q;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the navbar's search", () => {
  it("is one field, the magnifier only showing it below md", async () => {
    serve({ "GET /api/store/apps": () => Response.json(listing) });
    renderAt("/store");

    fireEvent.click(await screen.findByRole("button", { name: "Open search" }));

    expect(document.querySelectorAll('input[type="search"]')).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Close search" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("puts what is typed in ?q=, and follows a ?q= changed from elsewhere", async () => {
    serve({ "GET /api/store/apps": () => Response.json(listing) });

    const router = renderAt("/store?q=mini");

    await waitFor(() => expect(field().value).toBe("mini"));
    fireEvent.change(field(), { target: { value: "frig" } });
    await waitFor(() => expect(query(router)).toBe("frig"));

    await act(() => router.navigate({ to: "/store", search: { q: "jelly" } }));
    await waitFor(() => expect(field().value).toBe("jelly"));

    // Longer than the field waits before it writes ?q=: it does not write its own back.
    await act(() => new Promise(resolve => setTimeout(resolve, 500)));

    expect(query(router)).toBe("jelly");
    expect(field().value).toBe("jelly");

    await act(() => router.navigate({ to: "/store", search: {} }));
    await waitFor(() => expect(field().value).toBe(""));
  });

  it("is disabled on a page with no search", async () => {
    serve({ "GET /api/store": () => Response.json({ url: "u", installed: false, sync: null }) });
    renderAt("/settings");

    await waitFor(() => expect(field().disabled).toBe(true));
  });
});
