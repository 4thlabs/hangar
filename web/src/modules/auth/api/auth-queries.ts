import {
  getAuthLoginMutationOptions,
  getAuthLogoutMutationOptions,
  getAuthOptionsQueryOptions,
  getAuthSessionQueryKey,
  getAuthSessionQueryOptions,
} from "#libs/api";

/** The reads of the sign-in and of the user's menu. */
export const authQueries = {
  /** The signed-in user, which `Session.require()` has read before any page of the frame. */
  session: () => getAuthSessionQueryOptions(),
  /** How the server signs in: whether an identity provider is configured. */
  options: () => getAuthOptionsQueryOptions(),
};

/** Signing in and out. */
export const authMutations = {
  /** Signs in by password: the answer is the signed-in user, the session the frame then requires. */
  login: () =>
    getAuthLoginMutationOptions({
      mutation: {
        onSuccess: (user, _variables, _onMutateResult, { client }) =>
          client.setQueryData(getAuthSessionQueryKey(), user),
      },
    }),
  /** Signs out. The menu then empties the client, once the call is done: nothing read is kept for the next user. */
  logout: () => getAuthLogoutMutationOptions(),
};
