/** The Frigate card's words. */
export class FrigateMessages {
  static readonly en = {
    title: "Frigate",
    errorDescription: "The camera events could not be loaded.",
    cameras: ({ count }: { count: number }) => (count === 1 ? "1 camera" : `${count} cameras`),
    inference: ({ name }: { name: string }) => `${name} detector inference time`,
    empty: "No recent events.",
  };

  static readonly fr: typeof FrigateMessages.en = {
    title: "Frigate",
    errorDescription: "Les événements des caméras n’ont pas pu être chargés.",
    cameras: ({ count }) => (count > 1 ? `${count} caméras` : `${count} caméra`),
    inference: ({ name }) => `Temps d’inférence du détecteur ${name}`,
    empty: "Aucun événement récent.",
  };
}
