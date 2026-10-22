import "server-only";
import path from "node:path";
import { env } from "#libs/env";
import { hangar } from "#libs/hangar/server";
import { HostShells } from "../host-shells.ts";
import { SshKeyStore } from "../ssh-key-store.ts";
import { SshKnownHosts } from "../ssh-known-hosts.ts";

/** Hangar's own SSH folder, beside its database: the key it was given and the host keys it trusts. */
const directory = path.join(hangar.store.appDataPath, "hangar", "ssh");

/** The key the operator gave Hangar to sign in with; without one, the terminal asks for the password. */
export const sshKeys = new SshKeyStore(path.join(directory, "id_key"));

/** The host keys Hangar trusts, recorded on first contact. */
export const sshKnownHosts = new SshKnownHosts(path.join(directory, "known_hosts"));

/** Shells on the host, or `null` until `HANGAR_SSH_HOST` and `HANGAR_SSH_USER` name it. */
export const hostShells =
  env.HANGAR_SSH_HOST && env.HANGAR_SSH_USER
    ? new HostShells(
        {
          host: env.HANGAR_SSH_HOST,
          port: env.HANGAR_SSH_PORT ? Number(env.HANGAR_SSH_PORT) : HostShells.DefaultPort,
          username: env.HANGAR_SSH_USER,
        },
        sshKeys,
        sshKnownHosts,
      )
    : null;
