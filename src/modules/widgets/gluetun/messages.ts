/** The Gluetun card's words. */
export class GluetunMessages {
  static readonly en = {
    title: "Gluetun",
    errorDescription: "The VPN status could not be read.",
    connected: "Your VPN is connected!",
    disconnected: "Your VPN is not connected!",
  };

  static readonly fr: typeof GluetunMessages.en = {
    title: "Gluetun",
    errorDescription: "L’état du VPN n’a pas pu être lu.",
    connected: "Votre VPN est connecté !",
    disconnected: "Votre VPN n’est pas connecté !",
  };
}
