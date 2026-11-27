import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { getJobsListMockHandler, getStoreAppsMockHandler, getStoreStatusMockHandler } from "#libs/api/mock";
import { network } from "#mock/network.ts";
import { renderAt } from "#mock/page.tsx";

/** The store, with no app. */
const emptyStore = getStoreAppsMockHandler({ apps: [], counts: { installed: 0, available: 0 } });

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
});

describe("the navbar's search", () => {
  it("is one field, the magnifier only showing it below md", async () => {
    network.use(emptyStore);
    renderAt("/store");

    fireEvent.click(await screen.findByRole("button", { name: "Open search" }));

    expect(document.querySelectorAll('input[type="search"]')).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Close search" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("puts what is typed in ?q=, and follows a ?q= changed from elsewhere", async () => {
    network.use(emptyStore);

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

  it("follows a ?q= from elsewhere that is one the field sent before", async () => {
    network.use(emptyStore);

    const router = renderAt("/store");

    fireEvent.change(await screen.findByLabelText("Search", { selector: "input" }), { target: { value: "alpha" } });
    await waitFor(() => expect(query(router)).toBe("alpha"));

    await act(() => router.navigate({ to: "/store", search: { q: "beta" } }));
    await waitFor(() => expect(field().value).toBe("beta"));
    await act(() => router.navigate({ to: "/store", search: { q: "alpha" } }));
    await waitFor(() => expect(field().value).toBe("alpha"));

    // Longer than the field waits before it writes ?q=: it does not write beta back.
    await act(() => new Promise(resolve => setTimeout(resolve, 500)));

    expect(query(router)).toBe("alpha");
  });

  it("is disabled on a page with no search", async () => {
    network.use(getStoreStatusMockHandler({ url: "u", installed: false, sync: null }), getJobsListMockHandler([]));
    renderAt("/settings");

    await waitFor(() => expect(field().disabled).toBe(true));
  });
});
