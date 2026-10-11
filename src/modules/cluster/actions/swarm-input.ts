/** What the swarm forms send, checked before it reaches the daemon. */
export class SwarmInput {
  /** A `host`, `host:port`, `[ipv6]:port` or an interface name such as `eth0`. */
  private static readonly Address = /^[\w.:[\]-]{1,255}$/;

  /** A join token, as `docker swarm join-token` prints it. */
  private static readonly JoinToken = /^SWMTKN-1-[\w-]{1,255}$/;

  static isAddress(value: string) {
    return SwarmInput.Address.test(value);
  }

  static isJoinToken(value: string) {
    return SwarmInput.JoinToken.test(value);
  }
}
