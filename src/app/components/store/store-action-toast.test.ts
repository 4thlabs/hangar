import { describe, expect, it } from "vitest";
import { createStoreActionToast, createStoreTransportErrorToast } from "./store-action-toast.ts";

const titles = {
  success: "Success",
  error: "Failure",
};

describe("createStoreActionToast", () => {
  it("uses the success title and type for a successful result", () => {
    expect(createStoreActionToast({ success: true, installed: true, message: "Done" }, titles)).toEqual({
      title: "Success",
      description: "Done",
      type: "success",
    });
  });

  it("uses the error title and type while preserving the action message", () => {
    expect(createStoreActionToast({ success: false, installed: false, message: "Not done" }, titles)).toEqual({
      title: "Failure",
      description: "Not done",
      type: "error",
    });
  });
});

describe("createStoreTransportErrorToast", () => {
  it("returns the common transport failure message", () => {
    expect(createStoreTransportErrorToast("Unavailable")).toEqual({
      title: "Unavailable",
      description: "Impossible de contacter le serveur. Réessayez.",
      type: "error",
    });
  });
});
