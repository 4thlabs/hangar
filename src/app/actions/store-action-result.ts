export type StoreActionResult = {
  success: boolean;
  installed: boolean;
  message: string;
};

export const StoreActionResult = {
  success(message: string, installed = true): StoreActionResult {
    return { success: true, installed, message };
  },

  failure(message: string, installed = false): StoreActionResult {
    return { success: false, installed, message };
  },
};
