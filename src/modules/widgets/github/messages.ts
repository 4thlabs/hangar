/** The GitHub releases card's words. */
export class GithubMessages {
  static readonly en = {
    title: "Releases",
    errorDescription: "The GitHub releases could not be loaded.",
    empty: "No releases found.",
  };

  static readonly fr: typeof GithubMessages.en = {
    title: "Releases",
    errorDescription: "Les releases GitHub n’ont pas pu être chargées.",
    empty: "Aucune release trouvée.",
  };
}
